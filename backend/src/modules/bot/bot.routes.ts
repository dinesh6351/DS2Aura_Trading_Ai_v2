import { Router } from 'express';
import { z } from 'zod';
import { TradingMode, MODE_PRESETS } from '@platform/shared';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { authenticate, type AuthedRequest } from '../../middleware/auth.js';
import { ok, Errors } from '../../lib/http.js';
import { billingService } from '../fees/billing.service.js';
import { learningOverview } from './learning.service.js';
import { startOfDayUtc } from '../../lib/time.js';

export const botRouter = Router();
botRouter.use(authenticate);

const uid = (req: unknown) => (req as AuthedRequest).auth.userId;
const role = (req: unknown) => (req as AuthedRequest).auth.role;

/** GET /api/bot/status — current bot config + runtime state for THIS user. */
botRouter.get('/status', asyncHandler(async (req, res) => {
  const cfg = await prisma.botConfig.findUnique({ where: { userId: uid(req) } });
  if (!cfg) throw Errors.notFound('No bot config');
  // Never leak the (encrypted) Telegram token envelope to the client.
  const { telegramBotTokenEnc, ...safe } = cfg;
  void telegramBotTokenEnc;
  return ok(res, safe);
}));

/** POST /api/bot/start — requires a valid API key on file. */
botRouter.post('/start', asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!(await billingService.canTradeNow(userId))) {
    throw Errors.forbidden('Your trial/subscription has ended. Subscribe to re-enable the bot (view-only until then).');
  }
  const key = await prisma.apiKey.findFirst({ where: { userId, status: 'VALID', canTrade: true } });
  if (!key) throw Errors.badRequest('Connect a valid Binance key with Futures permission first');
  // If a NEW local day has begun since the last reset, clear today's trade counter so
  // Start isn't immediately re-paused by a stale daily-limit count (same-day at the
  // cap is left as-is, so restarting can't bypass the limit within the same day).
  const [cur, profile] = await Promise.all([
    prisma.botConfig.findUnique({ where: { userId }, select: { lastDailyResetAt: true } }),
    prisma.profile.findUnique({ where: { userId }, select: { timezone: true } }),
  ]);
  const newDay = !cur?.lastDailyResetAt || cur.lastDailyResetAt < startOfDayUtc(profile?.timezone || 'UTC');
  const cfg = await prisma.botConfig.update({
    where: { userId },
    data: {
      status: 'RUNNING', pausedReason: null, consecutiveLosses: 0,
      ...(newDay ? { tradesToday: 0, lastDailyResetAt: new Date() } : {}),
    },
  });
  await prisma.auditLog.create({ data: { userId, action: 'BOT_START' } });
  return ok(res, cfg);
}));

botRouter.post('/pause', asyncHandler(async (req, res) => {
  const userId = uid(req);
  const cfg = await prisma.botConfig.update({ where: { userId }, data: { status: 'PAUSED' } });
  await prisma.auditLog.create({ data: { userId, action: 'BOT_PAUSE' } });
  return ok(res, cfg);
}));

botRouter.post('/stop', asyncHandler(async (req, res) => {
  const userId = uid(req);
  const cfg = await prisma.botConfig.update({ where: { userId }, data: { status: 'STOPPED' } });
  await prisma.auditLog.create({ data: { userId, action: 'BOT_STOP' } });
  return ok(res, cfg);
}));

/** POST /api/bot/mode — apply a risk preset (Conservative/Balanced/Aggressive). */
botRouter.post('/mode', asyncHandler(async (req, res) => {
  const userId = uid(req);
  const mode = z.nativeEnum(TradingMode).parse(req.body.mode);
  const p = MODE_PRESETS[mode];
  const cfg = await prisma.botConfig.update({
    where: { userId },
    data: { mode, scoreThreshold: p.scoreThreshold, leverage: p.leverage,
      marginPerTradeUsd: p.marginPerTradeUsd, slPercent: p.slPercent, tpRR: p.tpRR,
      maxConcurrentPositions: p.maxConcurrentPositions, maxTradesPerDay: p.maxTradesPerDay,
      maxConsecutiveLosses: p.maxConsecutiveLosses, lossCooldownMin: p.lossCooldownMin },
  });
  await prisma.auditLog.create({ data: { userId, action: 'BOT_MODE_CHANGE', metadata: { mode } } });
  return ok(res, cfg);
}));

/** PATCH /api/bot/config — fine-grained settings (no code change needed). */
const configSchema = z.object({
  paperTrading: z.boolean().optional(),
  scoreThreshold: z.number().min(50).max(100).optional(),
  leverage: z.number().min(1).max(50).optional(),
  marginPerTradeUsd: z.number().min(1).max(100000).optional(),
  dynamicSizing: z.boolean().optional(),
  slPercent: z.number().min(0.1).max(20).optional(),
  tpRR: z.number().min(0.5).max(20).optional(),
  trailArmPct: z.number().min(0.1).max(10).optional(),
  trailGapPct: z.number().min(0.05).max(10).optional(),
  // Scaled take-profit ladder
  useScaledTp: z.boolean().optional(),
  tp1Pct: z.number().min(0.2).max(5).optional(),
  tp1SizePct: z.number().int().min(10).max(80).optional(),
  tp2Frac: z.number().min(0.2).max(0.95).optional(),
  tp2SizePct: z.number().int().min(10).max(80).optional(),
  maxConcurrentPositions: z.number().min(1).max(20).optional(),
  maxTradesPerDay: z.number().min(0).max(100).optional(), // 0 = unlimited (admin only, enforced in handler)
  maxConsecutiveLosses: z.number().min(1).max(20).optional(),
  lossCooldownMin: z.number().min(0).max(720).optional(),
  marginGuardPct: z.number().min(10).max(100).optional(),
  useAdxFilter: z.boolean().optional(),
  useEmaTrend: z.boolean().optional(),
  useRsi: z.boolean().optional(),
  useVolume: z.boolean().optional(),
  useAtr: z.boolean().optional(),
  useBreakEven: z.boolean().optional(),
  useTrailingStop: z.boolean().optional(),
  useAdaptiveLearning: z.boolean().optional(),
}).refine(
  // When both tranche sizes are sent together, keep ≥10% for the trailing runner.
  (c) => c.tp1SizePct == null || c.tp2SizePct == null || c.tp1SizePct + c.tp2SizePct <= 90,
  { message: 'TP1 + TP2 size must leave at least 10% for the runner (≤ 90% combined).', path: ['tp2SizePct'] },
);

botRouter.patch('/config', asyncHandler(async (req, res) => {
  const userId = uid(req);
  const patch = configSchema.parse(req.body);
  // Unlimited daily trades (maxTradesPerDay = 0) is an admin-only privilege.
  if (patch.maxTradesPerDay === 0 && role(req) !== 'ADMIN') {
    throw Errors.badRequest('Unlimited daily trades is available to admins only.');
  }
  // Don't let a user flip paper⇄live while positions are open — the watchdog
  // branches on this flag, so a mid-flight switch would orphan open positions.
  if (patch.paperTrading !== undefined) {
    const open = await prisma.position.count({ where: { userId, status: 'OPEN' } });
    if (open > 0) throw Errors.badRequest('Close all open positions before switching between Paper and Live trading.');
  }
  const cfg = await prisma.botConfig.update({ where: { userId }, data: patch });
  await prisma.auditLog.create({ data: { userId, action: 'BOT_CONFIG_CHANGE', metadata: patch } });
  return ok(res, cfg);
}));

/** GET /api/bot/learning — per-coin adaptive-learning breakdown for THIS user. */
botRouter.get('/learning', asyncHandler(async (req, res) => {
  const cfg = await prisma.botConfig.findUnique({ where: { userId: uid(req) } });
  if (!cfg) throw Errors.notFound('No bot config');
  const overview = await learningOverview(uid(req), cfg.scoreThreshold);
  return ok(res, { enabled: cfg.useAdaptiveLearning, ...overview });
}));

/** GET /api/bot/log — recent bot activity (notifications channel). */
botRouter.get('/log', asyncHandler(async (req, res) => {
  const items = await prisma.notification.findMany({
    where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 50,
  });
  return ok(res, items);
}));
