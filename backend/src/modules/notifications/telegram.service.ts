import fetch from 'node-fetch';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { decryptSecret } from '../../lib/crypto.js';

/**
 * Telegram notifications. In the SaaS each user can register their own bot token
 * + chat id (stored on their Profile/SystemSetting), so alerts go to THEIR
 * Telegram — not a single shared channel like the original bot. If a user hasn't
 * configured one, we fall back to the platform token (if set) or skip silently.
 */
export async function sendTelegram(text: string, override?: { token?: string; chatId?: string }) {
  const token = override?.token ?? env.TELEGRAM_BOT_TOKEN;
  const chatId = override?.chatId;
  if (!token || !chatId) return; // not configured — no-op
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    logger.warn({ e }, 'telegram send failed');
  }
}

/** Decrypt a user's stored Telegram creds (null if disabled/unset). */
export async function getTelegramCreds(userId: string): Promise<{ token: string; chatId: string } | null> {
  const cfg = await prisma.botConfig.findUnique({ where: { userId } });
  if (!cfg?.telegramEnabled || !cfg.telegramBotTokenEnc || !cfg.telegramChatId) return null;
  try {
    return { token: decryptSecret(JSON.parse(cfg.telegramBotTokenEnc)), chatId: cfg.telegramChatId };
  } catch { return null; }
}

/** Send to a user's OWN Telegram bot (no-op if they haven't configured one). */
export async function sendUserTelegram(userId: string, text: string): Promise<void> {
  const creds = await getTelegramCreds(userId);
  if (!creds) return;
  await sendTelegram(text, creds);
}
