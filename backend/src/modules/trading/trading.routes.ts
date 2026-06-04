import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { authenticate, type AuthedRequest } from '../../middleware/auth.js';
import { ok } from '../../lib/http.js';
import { tradingService } from './trading.service.js';
import { getMarketStatus } from '../binance/market.service.js';
import { BinanceClient } from '../binance/binance.client.js';
import { manualClosePosition } from '../bot/engine.js';
import {
  aiTradePlan, multiTfSupportResistance, multiTfBias, snapshot, signalBreakdown, newsResearch,
  signalsOverview, pivotLevels, multiTfTable,
} from '../bot/analysis.service.js';
import { selectStrategy, fearGreedHistory } from '../bot/strategy-selector.service.js';

export const tradingRouter = Router();
tradingRouter.use(authenticate);
const uid = (req: unknown) => (req as AuthedRequest).auth.userId;

// ── Dashboard data ──────────────────────────────────────────────────────────
tradingRouter.get('/account', asyncHandler(async (req, res) => ok(res, await tradingService.account(uid(req)))));
tradingRouter.get('/positions', asyncHandler(async (req, res) => ok(res, await tradingService.positions(uid(req)))));
/** POST /api/trading/positions/:id/close — user-initiated manual close (market). */
tradingRouter.post('/positions/:id/close', asyncHandler(async (req, res) =>
  ok(res, await manualClosePosition(uid(req), req.params.id!))));
tradingRouter.get('/trades', asyncHandler(async (req, res) => ok(res, await tradingService.trades(uid(req)))));
tradingRouter.get('/stats', asyncHandler(async (req, res) => ok(res, await tradingService.stats(uid(req)))));
tradingRouter.get('/binance-pnl', asyncHandler(async (req, res) => ok(res, await tradingService.binancePnl(uid(req)))));
tradingRouter.get('/pnl/history', asyncHandler(async (req, res) => ok(res, await tradingService.pnlHistory(uid(req)))));

// ── Trader Performance Analysis ──────────────────────────────────────────────
tradingRouter.get('/performance', asyncHandler(async (req, res) => ok(res, await tradingService.performanceByCoin(uid(req)))));
tradingRouter.get('/trade-detail', asyncHandler(async (req, res) => {
  const symbol = z.string().min(3).parse(req.query.symbol);
  return ok(res, await tradingService.tradeDetail(uid(req), symbol));
}));

// ── Market status (shared) ───────────────────────────────────────────────────
tradingRouter.get('/market-status', asyncHandler(async (_req, res) => ok(res, await getMarketStatus())));

// ── Live last-prices for per-second PnL ticking on open positions (public,
//    cached ~1.5s — safe to poll every second). ────────────────────────────────
tradingRouter.get('/ticker', asyncHandler(async (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  return ok(res, await BinanceClient.tickerPrices(symbols));
}));

/** GET /api/trading/top-symbols?limit=N — top USDT futures coins by 24h volume (watchlist quick-fill). */
tradingRouter.get('/top-symbols', asyncHandler(async (req, res) => {
  const limit = z.coerce.number().min(1).max(50).default(10).parse(req.query.limit);
  return ok(res, await BinanceClient.topSymbols(limit));
}));

// ── Rich live signals (per watchlist coin: score, indicators, what's blocking).
//    Computed on demand so the dashboard shows signals even when the bot is
//    stopped; cached ~20s server-side. ─────────────────────────────────────────
tradingRouter.get('/signals', asyncHandler(async (req, res) => {
  const userId = uid(req);
  const wl = await prisma.watchlist.findFirst({ where: { userId, isDefault: true } });
  const symbols = (wl?.symbols ?? ['BTCUSDT']).slice(0, 50);
  const cfg = await prisma.botConfig.findUnique({ where: { userId } });
  const market = await getMarketStatus();
  return ok(res, await signalsOverview(symbols, cfg, market));
}));

// ── Chart-detail page (everything: AI plan, S/R, bias, snapshot, 19-condition
//    signal breakdown, market structure, news/research, market status) ────────
tradingRouter.get('/chart-detail', asyncHandler(async (req, res) => {
  const symbol = z.string().min(3).parse(req.query.symbol);
  const cfg = await prisma.botConfig.findUnique({ where: { userId: uid(req) } });
  const market = await getMarketStatus();
  const [plan, sr, bias, snap, signal, news, pivots, mtf] = await Promise.all([
    aiTradePlan(symbol), multiTfSupportResistance(symbol), multiTfBias(symbol),
    snapshot(symbol), signalBreakdown(symbol, cfg, market), newsResearch(symbol, market),
    pivotLevels(symbol), multiTfTable(symbol),
  ]);
  return ok(res, {
    symbol, aiTradePlan: plan, supportResistance: sr, multiTfBias: bias,
    snapshot: snap, signal, news, marketStatus: market, pivots, multiTf: mtf,
  });
}));

// ── AI Strategy Selection + Learning + Fear&Greed + Market Intel (one call for
//    the AI Learning Center / Strategy Performance / F&G / Feedback cards). ──────
tradingRouter.get('/intelligence', asyncHandler(async (req, res) => {
  const userId = uid(req);
  const market = await getMarketStatus();
  const [strategy, fgHistory, learning, intel] = await Promise.all([
    selectStrategy(market), fearGreedHistory(), tradingService.learning(userId), newsResearch('BTCUSDT', market),
  ]);
  const fg = market.fearGreed;
  const fgRec = fg.value <= 25 ? 'Extreme fear — contrarian long bias possible, but size down; capitulation risk.'
    : fg.value <= 45 ? 'Fear — take only strong, trend-aligned setups.'
    : fg.value <= 55 ? 'Neutral — let the active strategy decide.'
    : fg.value <= 75 ? 'Greed — trail stops tightly, do not chase extended moves.'
    : 'Extreme greed — high reversal risk; protect profits, reduce exposure.';
  return ok(res, { strategy, fearGreed: { value: fg.value, label: fg.label, cmc: market.fearGreedCmc, history: fgHistory, recommendation: fgRec }, learning, marketIntel: intel });
}));

// ── Watchlist ─────────────────────────────────────────────────────────────────
const watchlistSchema = z.object({ symbols: z.array(z.string().min(3).max(20)).min(1).max(50) });
tradingRouter.get('/watchlist', asyncHandler(async (req, res) => {
  const wl = await prisma.watchlist.findFirst({ where: { userId: uid(req), isDefault: true } });
  return ok(res, wl?.symbols ?? []);
}));
tradingRouter.put('/watchlist', asyncHandler(async (req, res) => {
  const { symbols } = watchlistSchema.parse(req.body);
  const userId = uid(req);
  const existing = await prisma.watchlist.findFirst({ where: { userId, isDefault: true } });
  const wl = existing
    ? await prisma.watchlist.update({ where: { id: existing.id }, data: { symbols } })
    : await prisma.watchlist.create({ data: { userId, symbols, isDefault: true } });
  return ok(res, wl.symbols);
}));

// ── Tax-ready CSV export (replaces trades.csv) ───────────────────────────────
tradingRouter.get('/export/trades.csv', asyncHandler(async (req, res) => {
  const trades = await tradingService.trades(uid(req), 10_000);
  const header = 'closedAt,symbol,side,entry,exit,qty,leverage,grossPnl,netPnl,exitReason\n';
  const rows = trades.map((t) =>
    [t.closedAt.toISOString(), t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity,
     t.leverage, t.grossPnl, t.netPnl, t.exitReason].join(','),
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
  return res.send(header + rows);
}));
