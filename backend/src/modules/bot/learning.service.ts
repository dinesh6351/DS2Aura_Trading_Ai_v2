import { prisma } from '../../lib/prisma.js';

/**
 * Adaptive learning (opt-in via BotConfig.useAdaptiveLearning).
 *
 * Learns ONLY from the user's own closed trades and adjusts the *quality bar*
 * (the score threshold) PER COIN. It deliberately never touches leverage,
 * position size, or the critical safety gates — so the worst it can do is make
 * the bot trade LESS. Direction of adjustment is conservative:
 *   - Coins that lose / have a poor win-rate over enough samples → RAISE the bar
 *     (be pickier), or PAUSE the coin entirely once it's clearly unprofitable.
 *   - Coins with a strong, proven win-rate → LOWER the bar slightly (let more of a
 *     working setup through), bounded.
 *
 * All numbers are computed from TradeHistory and cached per user (5 min) so a busy
 * sweep doesn't re-query the ledger for every coin on every tick.
 */

const LOOKBACK = 60;          // most-recent closed trades per coin that count
const MIN_SAMPLES = 5;        // need this many closed trades before adapting a coin
const BLOCK_SAMPLES = 8;      // and this many before we'll fully pause a coin
const MAX_RAISE = 10;         // never raise the bar more than +10 over the user's setting
const MAX_LOWER = 5;          // never lower it more than −5
const HARD_FLOOR = 60;        // effective threshold never below this
const HARD_CEIL = 100;        // ... and never above this
export const BLOCKED = 101;   // sentinel: coin paused by learning (a 0–100 score can never reach it)
const CACHE_MS = 5 * 60_000;

interface CoinStat { trades: number; wins: number; netPnl: number; lastClosedAt: number; }
const _cache = new Map<string, { at: number; stats: Map<string, CoinStat> }>();

/** Turn a coin's track record into an effective threshold + a human note. */
function adjust(base: number, s: CoinStat): { threshold: number; delta: number | null; note: string } {
  const winRate = s.trades > 0 ? s.wins / s.trades : 0;
  const pct = Math.round(winRate * 100);
  if (s.trades < MIN_SAMPLES) {
    return { threshold: base, delta: 0, note: `only ${s.trades} trade(s) — learning needs ≥${MIN_SAMPLES}, using base bar ${base}` };
  }
  // Clearly unprofitable with enough samples → pause the coin.
  if (s.trades >= BLOCK_SAMPLES && winRate < 0.35 && s.netPnl < 0) {
    return { threshold: BLOCKED, delta: null, note: `paused — ${pct}% win over ${s.trades} trades, net $${s.netPnl.toFixed(2)}` };
  }
  // Map win-rate around 50% to a bounded adjustment.
  let delta: number;
  if (winRate < 0.5) delta = Math.round(((0.5 - winRate) / 0.5) * MAX_RAISE);   // up to +10 at 0% win
  else delta = -Math.round(((winRate - 0.5) / 0.5) * MAX_LOWER);                // down to −5 at 100% win
  // Never relax the bar for a coin that's net-negative overall.
  if (s.netPnl < 0 && delta < 0) delta = 0;
  const threshold = Math.max(HARD_FLOOR, Math.min(HARD_CEIL, base + delta));
  const dir = delta > 0 ? `+${delta} (pickier)` : delta < 0 ? `${delta} (proven winner)` : '±0';
  return { threshold, delta, note: `${pct}% win / ${s.trades} trades, net $${s.netPnl.toFixed(2)} → bar ${dir}` };
}

/** Per-user per-coin stats from the recent trade ledger (cached). */
async function getStats(userId: string): Promise<Map<string, CoinStat>> {
  const c = _cache.get(userId);
  if (c && Date.now() - c.at < CACHE_MS) return c.stats;

  // Pull recent closed trades (desc) and keep the most recent LOOKBACK per coin.
  const trades = await prisma.tradeHistory.findMany({
    where: { userId }, orderBy: { closedAt: 'desc' }, take: 600,
    select: { symbol: true, netPnl: true, closedAt: true },
  });
  const stats = new Map<string, CoinStat>();
  const kept = new Map<string, number>();
  for (const t of trades) {
    const n = kept.get(t.symbol) ?? 0;
    if (n >= LOOKBACK) continue;
    kept.set(t.symbol, n + 1);
    const pnl = Number(t.netPnl);
    const s = stats.get(t.symbol) ?? { trades: 0, wins: 0, netPnl: 0, lastClosedAt: 0 };
    s.trades++; s.netPnl += pnl; if (pnl > 0) s.wins++;
    s.lastClosedAt = Math.max(s.lastClosedAt, +new Date(t.closedAt));
    stats.set(t.symbol, s);
  }
  _cache.set(userId, { at: Date.now(), stats });
  return stats;
}

/**
 * Effective per-coin score threshold for the engine. Returns the base threshold
 * unchanged when there's no track record yet (or learning is effectively a no-op).
 * A return value of BLOCKED (101) means "don't trade this coin right now".
 */
export async function effectiveThreshold(userId: string, base: number, symbol: string): Promise<number> {
  const s = (await getStats(userId)).get(symbol);
  return s ? adjust(base, s).threshold : base;
}

/** Per-coin learning breakdown for the dashboard "Adaptive Learning" card. */
export async function learningOverview(userId: string, base: number) {
  const stats = await getStats(userId);
  const coins = [...stats.entries()].map(([symbol, s]) => {
    const { threshold, delta, note } = adjust(base, s);
    return {
      symbol, trades: s.trades, winRate: Math.round((s.wins / s.trades) * 100),
      netPnl: +s.netPnl.toFixed(2), blocked: threshold === BLOCKED,
      threshold: threshold === BLOCKED ? null : threshold, delta, note,
    };
  }).sort((a, b) => a.netPnl - b.netPnl);
  return {
    baseThreshold: base,
    coinsLearned: coins.length,
    raised: coins.filter((c) => (c.delta ?? 0) > 0).length,
    lowered: coins.filter((c) => (c.delta ?? 0) < 0).length,
    blocked: coins.filter((c) => c.blocked).length,
    minSamples: MIN_SAMPLES,
    coins,
  };
}

/** Drop the cache for a user (call after a trade closes so learning reflects it). */
export function bustLearningCache(userId: string): void { _cache.delete(userId); }
