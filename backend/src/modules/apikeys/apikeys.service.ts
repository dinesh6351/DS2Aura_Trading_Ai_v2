import { prisma } from '../../lib/prisma.js';
import { encryptSecret, decryptSecret, maskKey, sha256 } from '../../lib/crypto.js';
import { BinanceClient, type BinanceCreds } from '../binance/binance.client.js';
import { Errors } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

/**
 * Stores each tenant's Binance keys ENCRYPTED (AES-256-GCM) and hands decrypted
 * creds only to the bot engine at tick time. Plaintext keys never leave this
 * module and are never logged or returned to the client.
 */
export const apiKeyService = {
  async upsert(userId: string, apiKey: string, secret: string, label = 'default') {
    // Validate against Binance BEFORE persisting.
    const probe = new BinanceClient({ apiKey, secret });
    let perms: { canTrade: boolean; canWithdraw: boolean };
    try {
      perms = await probe.validate();
    } catch (e) {
      throw Errors.badRequest('Could not validate Binance key (check key, secret, and Futures permission)', String(e));
    }
    if (!perms.canTrade) throw Errors.badRequest('This key cannot trade futures. Enable "Futures" permission.');

    // ── One Binance account = one user ──────────────────────────────────────
    // A SHA-256 of the API key fingerprints the Binance account. Reject it if the
    // SAME key is already linked to a DIFFERENT, non-revoked user, so one Binance
    // account can't be used to farm multiple free trials across signups.
    const fingerprint = sha256(apiKey);
    const clash = await prisma.apiKey.findFirst({
      where: { binanceUid: fingerprint, userId: { not: userId }, status: { not: 'REVOKED' } },
      select: { id: true },
    });
    if (clash) {
      throw Errors.conflict('This Binance API key is already connected to another account. Each Binance account can be linked to only one user — disconnect it from the other account first, or use a key from a different Binance account.');
    }

    const k = encryptSecret(apiKey);
    const s = encryptSecret(secret);
    const row = await prisma.apiKey.upsert({
      where: { userId_exchange_label: { userId, exchange: 'BINANCE_FUTURES', label } },
      create: {
        userId, label, binanceUid: fingerprint,
        apiKeyCipher: k.cipher, apiKeyIv: k.iv, apiKeyTag: k.tag,
        secretCipher: s.cipher, secretIv: s.iv, secretTag: s.tag,
        status: 'VALID', canTrade: perms.canTrade, canWithdraw: perms.canWithdraw,
        lastValidatedAt: new Date(),
      },
      update: {
        binanceUid: fingerprint,
        apiKeyCipher: k.cipher, apiKeyIv: k.iv, apiKeyTag: k.tag,
        secretCipher: s.cipher, secretIv: s.iv, secretTag: s.tag,
        status: 'VALID', canTrade: perms.canTrade, canWithdraw: perms.canWithdraw,
        lastValidatedAt: new Date(), lastError: null,
      },
    });
    await prisma.auditLog.create({ data: { userId, action: 'API_KEY_ADDED', metadata: { label, masked: maskKey(apiKey) } } });
    // SECURITY: warn loudly if withdrawals are enabled (a key should be trade-only).
    return { id: row.id, status: row.status, canTrade: row.canTrade, canWithdraw: row.canWithdraw,
      warning: perms.canWithdraw ? 'This API key has WITHDRAWAL permission enabled. Disable it on Binance — the bot never needs it.' : undefined };
  },

  /** Internal-only: decrypt this user's creds for the engine. */
  async getDecryptedCreds(userId: string, label = 'default'): Promise<BinanceCreds> {
    const row = await prisma.apiKey.findUnique({
      where: { userId_exchange_label: { userId, exchange: 'BINANCE_FUTURES', label } },
    });
    if (!row || row.status === 'REVOKED') throw Errors.notFound('No Binance key on file');
    return {
      apiKey: decryptSecret({ cipher: row.apiKeyCipher, iv: row.apiKeyIv, tag: row.apiKeyTag }),
      secret: decryptSecret({ cipher: row.secretCipher, iv: row.secretIv, tag: row.secretTag }),
    };
  },

  /** Client-safe view: never includes ciphertext/plaintext. */
  async getPublic(userId: string) {
    const rows = await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({
      id: r.id, label: r.label, status: r.status, canTrade: r.canTrade,
      canWithdraw: r.canWithdraw, lastValidatedAt: r.lastValidatedAt,
    }));
  },

  /** Live connectivity test: decrypt creds, hit Binance, return balance + perms. */
  async testConnection(userId: string) {
    const creds = await this.getDecryptedCreds(userId);
    const client = new BinanceClient(creds);
    const [perms, balance] = await Promise.all([client.validate(), client.getBalance()]);
    await prisma.apiKey.updateMany({
      where: { userId, exchange: 'BINANCE_FUTURES' },
      data: { lastValidatedAt: new Date(), canTrade: perms.canTrade, canWithdraw: perms.canWithdraw, lastError: null },
    });
    return {
      connected: true, canTrade: perms.canTrade, canWithdraw: perms.canWithdraw,
      totalBalance: balance.totalUsdt, availableBalance: balance.availableUsdt,
      warning: perms.canWithdraw ? 'This key has WITHDRAWAL permission — disable it on Binance.' : undefined,
    };
  },

  async revoke(userId: string, id: string) {
    const row = await prisma.apiKey.findFirst({ where: { id, userId } });
    if (!row) throw Errors.notFound('Key not found');
    await prisma.apiKey.update({ where: { id }, data: { status: 'REVOKED' } });
    await prisma.botConfig.updateMany({ where: { userId }, data: { status: 'STOPPED', pausedReason: 'API key revoked' } });
    await prisma.auditLog.create({ data: { userId, action: 'API_KEY_REVOKED', metadata: { id } } });
  },

  /**
   * One-time backfill: stamp the dedup fingerprint (sha256 of the stored key) onto
   * any rows connected BEFORE one-account-one-user enforcement, so the clash check
   * in upsert() can see them. Best-effort + idempotent — only touches null rows.
   */
  async backfillKeyFingerprints(): Promise<void> {
    const rows = await prisma.apiKey.findMany({
      where: { binanceUid: null },
      select: { id: true, apiKeyCipher: true, apiKeyIv: true, apiKeyTag: true },
    });
    if (!rows.length) return;
    let stamped = 0;
    for (const r of rows) {
      try {
        const apiKey = decryptSecret({ cipher: r.apiKeyCipher, iv: r.apiKeyIv, tag: r.apiKeyTag });
        await prisma.apiKey.update({ where: { id: r.id }, data: { binanceUid: sha256(apiKey) } });
        stamped++;
      } catch { /* skip a row we can't decrypt (e.g. rotated enc key) */ }
    }
    logger.info({ scanned: rows.length, stamped }, 'api-key dedup fingerprints backfilled');
  },
};
