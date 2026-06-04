import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { isBanned } from '../binance/binance.client.js';
import { asyncHandler } from '../../middleware/error.js';

export const healthRouter = Router();

/** Liveness — no dependencies. */
healthRouter.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/** Readiness — checks DB + reports Binance ban state. */
healthRouter.get('/readyz', asyncHandler(async (_req, res) => {
  let db = false;
  try { await prisma.$queryRaw`SELECT 1`; db = true; } catch { db = false; }
  return res.status(db ? 200 : 503).json({ ok: db, db, binanceBan: isBanned() });
}));
