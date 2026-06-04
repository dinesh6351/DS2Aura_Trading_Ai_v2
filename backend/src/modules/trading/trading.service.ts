import { prisma } from '../../lib/prisma.js';
import { BinanceClient, isBanned } from '../binance/binance.client.js';
import { apiKeyService } from '../apikeys/apikeys.service.js';
import { logger } from '../../lib/logger.js';
import { startOfDayUtc } from '../../lib/time.js';

/**
 * On-demand LIVE account snapshot, independent of the bot's run state. The bot
 * tick only syncs while RUNNING, so a stopped-bot dashboard would otherwise show
 * stale/zero balances. Here we read the user's real Binance account (balance +
 * open positions) whenever they have a VALID key, cache it 15s per user (so a
 * dashboard refresh doesn't hammer Binance / trip the -1003 breaker), and persist
 * the balance back to tradingAccount so stats/ROI stay fresh too.
 */
interface LiveSnapshot {
  balance: { totalUsdt: number; availableUsdt: number; unrealizedPnl: number; marginUsed: number } | null;
  positions: Array<{ symbol: string; positionAmt: number; entryPrice: number; markPrice: number; unRealizedProfit: number; leverage: number }> | null;
}
const _liveCache = new Map<string, { at: number; data: LiveSnapshot }>();

interface PnlBucket { net: number; realizedPnl: number; fees: number; funding: number; trades: number }
interface BinancePnl { live: boolean; paper?: boolean; today?: PnlBucket; week?: PnlBucket }
const _pnlCache = new Map<string, { at: number; data: BinancePnl }>();

interface IncomeRow { symbol: string; income: string; time: number; incomeType: string }
const _incomeCache = new Map<string, { at: number; data: IncomeRow[] }>();
const _incomeInFlight = new Set<string>();
/** Background refresh of the income cache — never blocks a request. */
async function refreshIncome(userId: string): Promise<void> {
  if (_incomeInFlight.has(userId)) return;
  _incomeInFlight.add(userId);
  try {
    const key = await prisma.apiKey.findFirst({ where: { userId, status: 'VALID' } });
    if (key && !isBanned()) {
      const client = new BinanceClient(await apiKeyService.getDecryptedCreds(userId));
      const data = await client.getAllIncome(Date.now() - 7 * 864e5);
      _incomeCache.set(userId, { at: Date.now(), data });
    } else {
      _incomeCache.set(userId, { at: Date.now(), data: _incomeCache.get(userId)?.data ?? [] });
    }
  } catch (e) { logger.warn({ userId, e }, 'income refresh failed (per-trade fees)'); }
  finally { _incomeInFlight.delete(userId); }
}
/** Cached Binance income (last 7d). Returns immediately (stale-while-revalidate) so
 *  fee enrichment never blocks the trades request; fees fill in on the next poll. */
function userIncome7d(userId: string): IncomeRow[] {
  const c = _incomeCache.get(userId);
  if (!c || Date.now() - c.at >= 60_000) void refreshIncome(userId); // refresh in the background
  return c?.data ?? [];
}

async function liveSnapshot(userId: string): Promise<LiveSnapshot> {
  const cached = _liveCache.get(userId);
  if (cached && Date.now() - cached.at < 15_000) return cached.data;
  let data: LiveSnapshot = { balance: null, positions: null };
  if (!isBanned()) {
    try {
      const key = await prisma.apiKey.findFirst({ where: { userId, status: 'VALID' } });
      if (key) {
        const client = new BinanceClient(await apiKeyService.getDecryptedCreds(userId));
        const [bal, pos] = await Promise.all([client.getBalance(), client.getPositions()]);
        const unreal = pos.reduce((s, p) => s + p.unRealizedProfit, 0);
        data = {
          balance: { totalUsdt: bal.totalUsdt, availableUsdt: bal.availableUsdt, unrealizedPnl: unreal, marginUsed: bal.totalUsdt - bal.availableUsdt },
          positions: pos,
        };
        await prisma.tradingAccount.updateMany({
          where: { userId },
          data: { totalBalance: bal.totalUsdt, availableBalance: bal.availableUsdt,
                   unrealizedPnl: unreal, marginUsed: bal.totalUsdt - bal.availableUsdt, lastSyncedAt: new Date() },
        });
      }
    } catch (e) { logger.warn({ userId, e }, 'live snapshot failed — using DB fallback'); }
  }
  _liveCache.set(userId, { at: Date.now(), data });
  return data;
}

/**
 * Read models for the user dashboard. Everything is scoped by userId — the
 * controller passes the JWT subject, never a client-supplied id.
 */
export const tradingService = {
  async account(userId: string) {
    const [live, acct, cfg, openCount] = await Promise.all([
      liveSnapshot(userId),
      prisma.tradingAccount.findFirst({ where: { userId } }),
      prisma.botConfig.findUnique({ where: { userId }, select: { paperTrading: true } }),
      prisma.position.count({ where: { userId, status: 'OPEN' } }),
    ]);
    const b = live.balance;
    // Open count: paper → our simulated DB rows; live → real exchange positions.
    const open = cfg?.paperTrading ? openCount : (live.positions ? live.positions.length : openCount);
    return {
      totalBalance: b ? b.totalUsdt : Number(acct?.totalBalance ?? 0),
      availableBalance: b ? b.availableUsdt : Number(acct?.availableBalance ?? 0),
      marginUsed: b ? b.marginUsed : Number(acct?.marginUsed ?? 0),
      unrealizedPnl: b ? b.unrealizedPnl : Number(acct?.unrealizedPnl ?? 0),
      currency: acct?.currency ?? 'USDT',
      openPositions: open,
      lastSyncedAt: b ? new Date() : acct?.lastSyncedAt ?? null,
      live: !!b, // true = numbers came straight from Binance just now
    };
  },

  async positions(userId: string) {
    const cfg = await prisma.botConfig.findUnique({ where: { userId }, select: { paperTrading: true } });
    const dbPos = await prisma.position.findMany({ where: { userId, status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    // Paper mode: the simulated DB rows ARE the source of truth.
    if (cfg?.paperTrading) return dbPos;
    // Live mode: show what's actually on the exchange (works even when the bot is
    // stopped), enriched with SL/TP/score from our DB row when the bot opened it.
    const live = await liveSnapshot(userId);
    if (!live.positions) return dbPos;
    const bySym = new Map(dbPos.map((p) => [p.symbol, p]));
    return live.positions.map((p) => {
      const long = p.positionAmt > 0;
      const db = bySym.get(p.symbol);
      return {
        id: db?.id ?? p.symbol,
        symbol: p.symbol, side: long ? 'LONG' : 'SHORT',
        entryPrice: String(p.entryPrice), markPrice: String(p.markPrice),
        quantity: String(Math.abs(p.positionAmt)), leverage: p.leverage,
        stopLoss: db?.stopLoss != null ? String(db.stopLoss) : null,
        takeProfit: db?.takeProfit != null ? String(db.takeProfit) : null,
        unrealizedPnl: String(p.unRealizedProfit),
        entryScore: db?.entryScore ?? null,
      };
    });
  },

  async trades(userId: string, limit = 100) {
    const rows = await prisma.tradeHistory.findMany({ where: { userId }, orderBy: { closedAt: 'desc' }, take: limit });
    const cfg = await prisma.botConfig.findUnique({ where: { userId }, select: { paperTrading: true } });
    if (cfg?.paperTrading || !rows.length) return rows.map((r) => ({ ...r, realFee: 0, funding: 0 }));
    // Enrich each trade with its REAL Binance fee + funding, matched from the income
    // feed by symbol within the trade's open→close window (the bot never stacks a
    // symbol, so the match is unambiguous). Falls back to 0 if income isn't available.
    const income = userIncome7d(userId); // cached, non-blocking
    return rows.map((r) => {
      const o = r.openedAt.getTime() - 3000, c = r.closedAt.getTime() + 3000;
      let fee = 0, funding = 0;
      for (const i of income) {
        if (i.symbol !== r.symbol || i.time < o || i.time > c) continue;
        const v = Number(i.income);
        if (i.incomeType === 'COMMISSION') fee += v;
        else if (i.incomeType === 'FUNDING_FEE') funding += v;
      }
      return { ...r, realFee: +fee.toFixed(6), funding: +funding.toFixed(6) };
    });
  },

  /**
   * REAL Binance account P&L for today + last 7d, reconciled from the exchange's
   * own income feed (realized PnL + commission/fees + funding). This reflects the
   * ACTUAL wallet change — fees included, plus any activity the bot never recorded
   * (e.g. aborted entries) — so it always matches Binance. Cached 60s (income is a
   * weight-30 endpoint). Paper mode / no key → { live:false }.
   */
  async binancePnl(userId: string): Promise<BinancePnl> {
    const cached = _pnlCache.get(userId);
    if (cached && Date.now() - cached.at < 60_000) return cached.data;

    const cfg = await prisma.botConfig.findUnique({ where: { userId }, select: { paperTrading: true } });
    const key = await prisma.apiKey.findFirst({ where: { userId, status: 'VALID' } });
    let data: BinancePnl = { live: false, paper: !!cfg?.paperTrading };
    if (!cfg?.paperTrading && key && !isBanned()) {
      try {
        const client = new BinanceClient(await apiKeyService.getDecryptedCreds(userId));
        const weekStart = Date.now() - 7 * 864e5;
        const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
        const income = await client.getAllIncome(weekStart);
        const agg = (fromMs: number): PnlBucket => {
          let realized = 0, fees = 0, funding = 0, other = 0, trades = 0;
          for (const i of income) {
            if (i.time < fromMs) continue;
            const v = Number(i.income);
            if (i.incomeType === 'REALIZED_PNL') { realized += v; trades++; }
            else if (i.incomeType === 'COMMISSION') fees += v;       // negative (fee paid)
            else if (i.incomeType === 'FUNDING_FEE') funding += v;
            else other += v;
          }
          return {
            net: +(realized + fees + funding + other).toFixed(4),
            realizedPnl: +realized.toFixed(4), fees: +fees.toFixed(4),
            funding: +funding.toFixed(4), trades,
          };
        };
        data = { live: true, today: agg(todayStart.getTime()), week: agg(weekStart) };
      } catch (e) { logger.warn({ userId, e }, 'binancePnl fetch failed'); data = { live: false }; }
    }
    _pnlCache.set(userId, { at: Date.now(), data });
    return data;
  },

  async stats(userId: string) {
    const [trades, profile, cfg, acct] = await Promise.all([
      prisma.tradeHistory.findMany({ where: { userId } }),
      prisma.profile.findUnique({ where: { userId }, select: { timezone: true } }),
      prisma.botConfig.findUnique({ where: { userId }, select: { lastDailyResetAt: true } }),
      prisma.tradingAccount.findFirst({ where: { userId } }),
    ]);
    const tz = profile?.timezone || 'UTC';
    const wins = trades.filter((t) => Number(t.grossPnl) > 0).length;
    const realized = trades.reduce((s, t) => s + Number(t.netPnl), 0);
    const now = Date.now();
    const sum = (from: number) => trades.filter((t) => t.closedAt.getTime() >= from)
      .reduce((s, t) => s + Number(t.netPnl), 0);
    const equity = Number(acct?.totalBalance ?? 0);
    return {
      totalTrades: trades.length,
      winRate: trades.length ? +(wins / trades.length * 100).toFixed(1) : 0,
      realizedPnl: +realized.toFixed(4),
      todayProfit: +sum(startOfDayUtc(tz).getTime()).toFixed(4), // calendar TODAY in the user's region
      weeklyProfit: +sum(now - 7 * 864e5).toFixed(4),
      monthlyProfit: +sum(now - 30 * 864e5).toFixed(4),
      roi: equity > 0 ? +((realized / equity) * 100).toFixed(2) : 0,
      timezone: tz,
      lastResetAt: cfg?.lastDailyResetAt ?? null,
    };
  },

  pnlHistory(userId: string, days = 30) {
    const from = new Date(Date.now() - days * 864e5);
    return prisma.pnlHistory.findMany({
      where: { userId, date: { gte: from } }, orderBy: { date: 'asc' },
    });
  },

  /** Trader Performance Analysis — per-coin rollup (ported from the dashboard panel). */
  async performanceByCoin(userId: string) {
    const trades = await prisma.tradeHistory.findMany({ where: { userId } });
    const byCoin = new Map<string, { trades: number; wins: number; pnl: number; volume: number }>();
    for (const t of trades) {
      const c = byCoin.get(t.symbol) ?? { trades: 0, wins: 0, pnl: 0, volume: 0 };
      c.trades++; if (Number(t.grossPnl) > 0) c.wins++;
      c.pnl += Number(t.netPnl);
      c.volume += Number(t.entryPrice) * Number(t.quantity);
      byCoin.set(t.symbol, c);
    }
    return [...byCoin.entries()].map(([symbol, s]) => ({
      symbol, trades: s.trades, wins: s.wins,
      winRate: s.trades ? +(s.wins / s.trades * 100).toFixed(1) : 0,
      netPnl: +s.pnl.toFixed(4), volume: +s.volume.toFixed(2),
      // rule-based risk score 0–100 (higher = riskier)
      riskScore: coinRiskScore(s.wins / (s.trades || 1)),
    })).sort((a, b) => b.netPnl - a.netPnl);
  },

  /** Round-trip reconstruction for the trade-detail modal. */
  async tradeDetail(userId: string, symbol: string) {
    const trips = await prisma.tradeHistory.findMany({
      where: { userId, symbol }, orderBy: { closedAt: 'desc' }, take: 50,
    });
    return trips.map((t) => ({
      id: t.id, side: t.side, entry: Number(t.entryPrice), exit: Number(t.exitPrice),
      netPnl: Number(t.netPnl), grossPnl: Number(t.grossPnl),
      rr: t.rr ? Number(t.rr) : null, durationSec: t.durationSec, exitReason: t.exitReason,
      openedAt: t.openedAt, closedAt: t.closedAt,
      analysis: tripAiAnalysis(t.exitReason, Number(t.grossPnl)),
    }));
  },

  /** Trade Feedback & Learning (§18) — derived from the user's trade history. */
  async learning(userId: string) {
    const trades = await prisma.tradeHistory.findMany({ where: { userId }, orderBy: { closedAt: 'desc' }, take: 200 });
    const wins = trades.filter((t) => Number(t.netPnl) > 0);
    const losses = trades.filter((t) => Number(t.netPnl) < 0);
    const winRate = trades.length ? +(wins.length / trades.length * 100).toFixed(1) : 0;
    const gross = wins.reduce((s, t) => s + Number(t.netPnl), 0);
    const lossSum = Math.abs(losses.reduce((s, t) => s + Number(t.netPnl), 0));
    const profitFactor = lossSum > 0 ? +(gross / lossSum).toFixed(2) : gross > 0 ? 999 : 0;

    const byReason: Record<string, { count: number; pnl: number }> = {};
    for (const t of trades) {
      const r = t.exitReason ?? 'OTHER';
      const e = byReason[r] ?? { count: 0, pnl: 0 };
      e.count++; e.pnl = +(e.pnl + Number(t.netPnl)).toFixed(3);
      byReason[r] = e;
    }
    const perf = await this.performanceByCoin(userId);
    const best = [...perf].sort((a, b) => b.netPnl - a.netPnl).slice(0, 3);
    const worst = [...perf].sort((a, b) => a.netPnl - b.netPnl).slice(0, 3);
    const recent = trades.slice(0, 6).map(feedbackRecord);

    const lessons: string[] = [];
    if (losses.length) {
      const slPct = Math.round(losses.filter((t) => t.exitReason === 'SL').length / losses.length * 100);
      lessons.push(`${slPct}% of losses exit at the hard stop — capital protection is working as designed.`);
    }
    if (wins.length) lessons.push(`Winners mostly exit via ${dominantReason(wins)} — let the profit-lock ladder run rather than closing early.`);
    if (best[0] && best[0].netPnl > 0) lessons.push(`${best[0].symbol} is your strongest setup (+$${best[0].netPnl.toFixed(2)}) — it suits the current playbook.`);
    if (worst[0] && worst[0].netPnl < 0) lessons.push(`${worst[0].symbol} is dragging the book (${worst[0].netPnl.toFixed(2)}) — tighten its filter or pause it.`);
    if (!trades.length) lessons.push('No completed trades yet — run Paper mode to build a verified performance history.');

    return {
      totalTrades: trades.length, winRate, profitFactor, byReason, best, worst, recent, lessons,
      topWinning: ['Trend-aligned entries (price + EMA + BTC agree)', 'Score ≥ threshold (high-quality)', 'Volume confirmation ≥ 1.3×', 'Multi-TF agreement'],
      topLosing: ['Counter-trend / against BTC', 'Low ADX (chop / ranging)', 'Entered into nearby resistance/support', 'Below score threshold (forced)'],
    };
  },
};

function dominantReason(trades: { exitReason: string | null }[]): string {
  const c: Record<string, number> = {};
  for (const t of trades) c[t.exitReason ?? 'OTHER'] = (c[t.exitReason ?? 'OTHER'] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'TP';
}

function feedbackRecord(t: { id: string; symbol: string; side: string; exitReason: string | null; netPnl: unknown; rr: unknown; closedAt: Date }) {
  const pnl = Number(t.netPnl); const win = pnl > 0; const r = t.exitReason;
  const worked = win
    ? (r === 'TP' ? 'Hit full take-profit target' : r === 'TRAIL' ? 'Trailing stop locked the move' : 'Closed in profit')
    : 'Loss was capped at the planned stop (no blow-up)';
  const failed = win ? '—' : (r === 'SL' ? 'Trend failed to follow through after entry' : 'Adverse / external close');
  const suggestion = win
    ? 'Repeat: trend-aligned, high-score entries in this regime.'
    : 'Avoid counter-trend entries; require ADX>25 + multi-TF agreement.';
  return { id: t.id, symbol: t.symbol, side: t.side, reason: r, netPnl: +pnl.toFixed(3), rr: t.rr ? Number(t.rr) : null, win, worked, failed, suggestion, closedAt: t.closedAt };
}

function coinRiskScore(winRate: number): number {
  // crude: low win rate ⇒ higher risk. Clamp 0–100.
  return Math.round(Math.max(0, Math.min(100, (1 - winRate) * 100)));
}

function tripAiAnalysis(reason: string | null, pnl: number): string {
  if (reason === 'TP') return 'Hit take-profit — full target reached, clean exit.';
  if (reason === 'TRAIL') return 'Trailing stop locked in profit after the move extended.';
  if (reason === 'SL') return pnl < 0 ? 'Stopped out — trend failed to follow through.' : 'Break-even stop protected the entry.';
  if (reason === 'EXTERNAL') return 'Closed outside the bot (manual or liquidation).';
  return 'Closed.';
}
