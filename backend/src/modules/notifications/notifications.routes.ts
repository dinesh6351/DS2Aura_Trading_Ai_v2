import { Router } from 'express';
import fetch from 'node-fetch';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { encryptSecret } from '../../lib/crypto.js';
import { asyncHandler } from '../../middleware/error.js';
import { authenticate, type AuthedRequest } from '../../middleware/auth.js';
import { ok, Errors } from '../../lib/http.js';
import { getTelegramCreds } from './telegram.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
const uid = (req: unknown) => (req as AuthedRequest).auth.userId;

/** GET /api/notifications/telegram — status (never returns the token). */
notificationsRouter.get('/telegram', asyncHandler(async (req, res) => {
  const cfg = await prisma.botConfig.findUnique({ where: { userId: uid(req) } });
  return ok(res, {
    enabled: cfg?.telegramEnabled ?? false,
    configured: !!cfg?.telegramBotTokenEnc,
    chatId: cfg?.telegramChatId ?? null,
  });
}));

const saveSchema = z.object({
  botToken: z.string().min(20).max(120),
  chatId: z.string().min(1).max(40),
});

/** POST /api/notifications/telegram — validate the bot token (getMe), then store
 *  it ENCRYPTED. Enables per-user alerts to the user's own Telegram. */
notificationsRouter.post('/telegram', asyncHandler(async (req, res) => {
  const { botToken, chatId } = saveSchema.parse(req.body);
  // Validate the token with Telegram's getMe before persisting.
  let botName = '';
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { method: 'GET' });
    const j = (await r.json()) as { ok: boolean; result?: { username?: string }; description?: string };
    if (!j.ok) throw new Error(j.description ?? 'Telegram rejected the bot token');
    botName = j.result?.username ?? '';
  } catch (e) {
    throw Errors.badRequest('Invalid Telegram bot token (check you copied it from @BotFather)', String(e));
  }
  const enc = JSON.stringify(encryptSecret(botToken));
  await prisma.botConfig.update({
    where: { userId: uid(req) },
    data: { telegramBotTokenEnc: enc, telegramChatId: chatId, telegramEnabled: true },
  });
  await prisma.auditLog.create({ data: { userId: uid(req), action: 'TELEGRAM_CONFIGURED', metadata: { botName } } });
  return ok(res, { configured: true, enabled: true, botName });
}));

/** POST /api/notifications/telegram/test — send a test message to confirm setup. */
notificationsRouter.post('/telegram/test', asyncHandler(async (req, res) => {
  const creds = await getTelegramCreds(uid(req));
  if (!creds) throw Errors.badRequest('Telegram is not configured yet. Save your bot token and chat id first.');
  let ok2 = false; let err = '';
  try {
    const r = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text: '✅ <b>DS2AuraTrading AI</b> — Telegram connected. You will receive trade alerts here.', parse_mode: 'HTML' }),
    });
    const j = (await r.json()) as { ok: boolean; description?: string };
    ok2 = j.ok; err = j.description ?? '';
  } catch (e) { err = String(e); }
  if (!ok2) throw Errors.badRequest(`Telegram test failed: ${err || 'check the chat id — send /start to your bot first'}`);
  return ok(res, { sent: true });
}));

/** POST /api/notifications/telegram/disable — turn alerts off (keeps the token). */
notificationsRouter.post('/telegram/disable', asyncHandler(async (req, res) => {
  await prisma.botConfig.update({ where: { userId: uid(req) }, data: { telegramEnabled: false } });
  return ok(res, { enabled: false });
}));
