import argon2 from 'argon2';
import nodemailer from 'nodemailer';
import * as OTPAuth from 'otpauth';
import { Role, SubscriptionStatus, SubscriptionPlan, type AuthTokens } from '@platform/shared';
import { prisma } from '../../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { encryptSecret, decryptSecret, randomToken, sha256, safeEqual } from '../../lib/crypto.js';
import { Errors } from '../../lib/http.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { billingService } from '../fees/billing.service.js';

interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  mobile?: string;
  country?: string;
  timezone?: string;
}

interface SessionMeta { ip?: string; userAgent?: string }

/**
 * Issue an access+refresh pair and persist the (hashed) refresh token as a
 * Session so it can be rotated/revoked. Refresh tokens are single-use:
 * presenting one rotates it (see `refresh`).
 */
async function issueTokens(
  user: { id: string; role: Role },
  meta: SessionMeta,
): Promise<AuthTokens> {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: '', // filled below after we know the token
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
    },
  });

  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: session.id });
  const refreshToken = signRefreshToken({ sub: user.id, sid: session.id });
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: await argon2.hash(refreshToken) },
  });

  return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL };
}

// ── Email OTP (verifies the account email; gates the Setup tab) ─────────────
// Codes are kept in-memory (short-lived, 10 min) so no schema/migration is needed.
const _emailOtp = new Map<string, { hash: string; expires: number; attempts: number; sentAt: number }>();
const OTP_TTL_MS = 10 * 60_000;

// Lazily-built SMTP transport (nodemailer). Configured from SMTP_URL, e.g.
// smtps://user:pass@smtp.gmail.com:465 or smtp://user:pass@host:587.
let _transport: nodemailer.Transporter | null | undefined;
function mailTransport(): nodemailer.Transporter | null {
  if (_transport === undefined) {
    _transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
    if (!_transport) logger.warn('SMTP_URL not set — email OTP will be shown on-screen instead of emailed');
  }
  return _transport;
}

/**
 * Deliver the OTP by email. Returns true if it was actually sent (then the code is
 * NOT exposed to the client). If SMTP isn't configured or sending fails, returns
 * false and the API hands the code back so the user can still verify (dev/fallback).
 */
async function sendEmailOtp(email: string, code: string): Promise<boolean> {
  const t = mailTransport();
  if (!t) { logger.info({ email, code }, 'EMAIL OTP (no SMTP — code shown to user)'); return false; }
  try {
    await t.sendMail({
      from: env.EMAIL_FROM || 'DS2AuraTrading <no-reply@ds2aura.trade>',
      to: email,
      subject: 'Your DS2AuraTrading verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
      html: `<p>Your DS2AuraTrading verification code is:</p>`
        + `<p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>`
        + `<p style="color:#888">It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    });
    return true;
  } catch (e) { logger.error({ e, email }, 'email OTP send failed — falling back to on-screen code'); return false; }
}

export const authService = {
  async register(input: RegisterInput, meta: SessionMeta) {
    const email = input.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw Errors.conflict('Email already registered');

    const passwordHash = await argon2.hash(input.password);
    const verifyToken = randomToken(24);

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: Role.TRADER,
          // store the email-verification token hash in metadata via a notification/audit; simplified here:
          profile: { create: { fullName: input.fullName, mobile: input.mobile, country: input.country, timezone: input.timezone || 'UTC' } },
          subscription: { create: {} }, // defaults to TRIAL/TRIALING; dates set by startTrial below
          wallet: { create: {} },
          botConfig: { create: {} },
          watchlists: { create: { symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] } },
          tradingAccounts: { create: {} },
        },
      });
      await tx.auditLog.create({
        data: { userId: u.id, action: 'REGISTER', ip: meta.ip, userAgent: meta.userAgent,
                metadata: { verifyTokenHash: sha256(verifyToken) } },
      });
      return u;
    });

    // Start the 30-day free trial. If this email/mobile already used a trial,
    // sign-up still succeeds but the account starts EXPIRED (must subscribe).
    try {
      await billingService.startTrial(user.id, { email, mobile: input.mobile ?? null });
    } catch (e) {
      await prisma.subscription.update({
        where: { userId: user.id },
        data: { status: SubscriptionStatus.EXPIRED, plan: SubscriptionPlan.TRIAL },
      });
      logger.warn({ userId: user.id, e }, 'trial blocked at registration (duplicate) — account starts view-only');
    }

    const tokens = await issueTokens({ id: user.id, role: user.role }, meta);
    // NOTE: send `verifyToken` via email in the notifications module.
    return { user: publicUser(user), tokens, verifyToken };
  },

  async login(email: string, password: string, totp: string | undefined, meta: SessionMeta) {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.passwordHash) throw Errors.unauthorized('Invalid credentials');
    if (user.status === 'DISABLED' || user.status === 'SUSPENDED') {
      throw Errors.forbidden('Account is not active. Contact support.');
    }
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw Errors.unauthorized('Invalid credentials');

    if (user.twoFactorEnabled) {
      if (!totp) throw Errors.badRequest('2FA code required', { needs2fa: true });
      const ok = verifyTotp(user.twoFactorSecret!, totp);
      if (!ok) throw Errors.unauthorized('Invalid 2FA code');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'LOGIN', ip: meta.ip, userAgent: meta.userAgent },
    });

    const tokens = await issueTokens({ id: user.id, role: user.role }, meta);
    return { user: publicUser(user), tokens };
  },

  /** Rotate: validate the presented refresh token against its session, then
   *  issue a brand-new pair and replace the stored hash. Re-use of an old token
   *  (already rotated) fails verification → forces re-login. */
  async refresh(refreshToken: string, meta: SessionMeta): Promise<AuthTokens> {
    let payload: { sub: string; sid: string };
    try { payload = verifyRefreshToken(refreshToken); }
    catch { throw Errors.unauthorized('Invalid refresh token'); }

    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw Errors.unauthorized('Session expired');
    }
    const matches = await argon2.verify(session.refreshTokenHash, refreshToken);
    if (!matches) {
      // Token reuse / theft suspected — revoke the whole session.
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw Errors.unauthorized('Refresh token reuse detected');
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });

    const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: session.id });
    const newRefresh = signRefreshToken({ sub: user.id, sid: session.id });
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: await argon2.hash(newRefresh), lastUsedAt: new Date(),
              ip: meta.ip, userAgent: meta.userAgent },
    });
    return { accessToken, refreshToken: newRefresh, expiresIn: env.JWT_ACCESS_TTL };
  },

  async logout(sessionId: string) {
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Change the account password. Verifies the CURRENT password, then revokes
   * every OTHER session (so a stolen/old device is logged out) while keeping the
   * session that made the change.
   */
  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) throw Errors.badRequest('This account signs in with Google/social login and has no password to change.');
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) throw Errors.unauthorized('Current password is incorrect');
    if (await argon2.verify(user.passwordHash, newPassword)) {
      throw Errors.badRequest('New password must be different from the current one.');
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(newPassword) } });
    await prisma.session.updateMany({
      where: { userId, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: new Date() },
    });
    await prisma.auditLog.create({ data: { userId, action: 'PASSWORD_CHANGED' } });
  },

  /** Send a 6-digit email-verification OTP (throttled to one per 30s). */
  async requestEmailOtp(userId: string): Promise<{ sent: boolean; devCode?: string }> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return { sent: true }; // already verified
    const prev = _emailOtp.get(userId);
    if (prev && Date.now() - prev.sentAt < 30_000) return { sent: true }; // throttle resends
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    _emailOtp.set(userId, { hash: sha256(code), expires: Date.now() + OTP_TTL_MS, attempts: 0, sentAt: Date.now() });
    const delivered = await sendEmailOtp(user.email, code);
    await prisma.auditLog.create({ data: { userId, action: 'EMAIL_OTP_SENT' } }).catch(() => {});
    // Until real email delivery is wired, hand the code back so the user can verify.
    return delivered ? { sent: true } : { sent: false, devCode: code };
  },

  /** Verify the email OTP → marks the email verified (unlocks the Setup tab). */
  async verifyEmailOtp(userId: string, code: string): Promise<void> {
    const rec = _emailOtp.get(userId);
    if (!rec) throw Errors.badRequest('Request a code first.');
    if (Date.now() > rec.expires) { _emailOtp.delete(userId); throw Errors.badRequest('Code expired — request a new one.'); }
    if (rec.attempts >= 5) { _emailOtp.delete(userId); throw Errors.badRequest('Too many attempts — request a new code.'); }
    rec.attempts++;
    if (!safeEqual(rec.hash, sha256(code.trim()))) throw Errors.badRequest('Incorrect code.');
    _emailOtp.delete(userId);
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId, action: 'EMAIL_VERIFIED' } }).catch(() => {});
  },

  // ── 2FA (TOTP) ──────────────────────────────────────────────────────────
  async beginEnable2fa(userId: string, accountLabel: string) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const enc = encryptSecret(secret);
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: JSON.stringify(enc), twoFactorEnabled: false },
    });
    const totp = new OTPAuth.TOTP({ issuer: 'ClaudeTrading', label: accountLabel, secret });
    return { otpauthUrl: totp.toString(), secret };
  },

  async confirmEnable2fa(userId: string, code: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret) throw Errors.badRequest('2FA setup not started');
    if (!verifyTotp(user.twoFactorSecret, code)) throw Errors.unauthorized('Invalid 2FA code');
    await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    await prisma.auditLog.create({ data: { userId, action: '2FA_ENABLED' } });
  },
};

function verifyTotp(storedSecret: string, code: string): boolean {
  // storedSecret is the encrypted JSON envelope of the base32 secret.
  const secret = decryptSecret(JSON.parse(storedSecret));
  const totp = new OTPAuth.TOTP({ secret });
  // window:1 tolerates ±30s clock drift.
  return totp.validate({ token: code, window: 1 }) !== null;
}

export function publicUser(u: { id: string; email: string; role: Role; status: string;
  twoFactorEnabled: boolean; emailVerifiedAt: Date | null }) {
  return {
    id: u.id, email: u.email, role: u.role, status: u.status,
    twoFactorEnabled: u.twoFactorEnabled, emailVerified: !!u.emailVerifiedAt,
  };
}
