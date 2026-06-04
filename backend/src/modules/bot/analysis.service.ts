import type { BotConfig } from '@prisma/client';
import { BinanceClient } from '../binance/binance.client.js';
import { getMarketStatus, type MarketStatus } from '../binance/market.service.js';
import {
  calcEMA, calcVWAP, calcRSI, calcMACD, calcATR, calcADX, avgVolume, emaSlope,
  detectCandlePattern, findSwingLevels, detectMarketStructure, computeBiasOnTf,
} from './indicators.js';
import { runSafetyCheck, type StrategyCtx } from './strategy.js';
import { buildCandleCtx } from './strategy-context.js';
import { effectiveThreshold } from './learning.service.js';

/**
 * Deterministic "AI" analysis — ported from the dashboard's rule-based engine.
 * No LLM. Same disclaimers as the original: explanations are derived from free
 * market signals, not a paid feed.
 */

const TF_POOL = ['15m', '1h', '4h', '1d'];

/** Multi-timeframe support/resistance, TF-tagged, pooled & sorted. */
export async function multiTfSupportResistance(symbol: string) {
  const levels: Array<{ tf: string; type: 'support' | 'resistance'; price: number }> = [];
  await Promise.all(TF_POOL.map(async (tf) => {
    const candles = await BinanceClient.klines(symbol, tf, 120).catch(() => []);
    if (candles.length < 30) return;
    const { support, resistance } = findSwingLevels(candles, 60);
    if (support != null) levels.push({ tf, type: 'support', price: support });
    if (resistance != null) levels.push({ tf, type: 'resistance', price: resistance });
  }));
  const last = (await BinanceClient.klines(symbol, '1m', 2))[0]?.close ?? 0;
  return {
    price: last,
    supports: levels.filter((l) => l.type === 'support').sort((a, b) => b.price - a.price),
    resistances: levels.filter((l) => l.type === 'resistance').sort((a, b) => a.price - b.price),
  };
}

/**
 * AI Trade Plan: optimal R:R (1:2 → 1:10) derived from S/R + ATR + ADX + volume
 * + BTC alignment — the same heuristic the chart-detail page used.
 */
export async function aiTradePlan(symbol: string) {
  const candles = await BinanceClient.klines(symbol, '1m', 250);
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const ema8 = calcEMA(closes, 8);
  const vwap = calcVWAP(candles);
  const rsi3 = calcRSI(closes, 3);
  const atr = calcATR(candles, 14);
  const adx = calcADX(candles, 14);
  const volRatio = candles[candles.length - 1]!.volume / (avgVolume(candles, 20) || 1);
  const { support, resistance } = findSwingLevels(candles, 50);
  const structure = detectMarketStructure(candles);
  const market = await getMarketStatus();

  const bias = price > vwap && price > ema8 ? 'long' : price < vwap && price < ema8 ? 'short' : 'none';
  if (bias === 'none') {
    return { symbol, bias, reasoning: 'No clean directional bias (price between VWAP/EMA8). Stand aside.' };
  }
  const long = bias === 'long';
  // R:R scales with trend strength (ADX) and BTC alignment.
  const btcAligned = long ? market.btcTrend !== 'bearish' : market.btcTrend !== 'bullish';
  let rr = 2;
  if (adx > 25) rr += 1;
  if (adx > 35) rr += 2;
  if (volRatio > 1.5) rr += 1;
  if (btcAligned) rr += 1;
  rr = Math.min(10, rr);

  const slDist = Math.max(atr * 1.2, price * 0.008); // ≥0.8% or 1.2×ATR
  const entry = price;
  const stop = long ? entry - slDist : entry + slDist;
  const target = long ? entry + slDist * rr : entry - slDist * rr;

  return {
    symbol, bias, entry: round(entry), stopLoss: round(stop), takeProfit: round(target),
    riskReward: `1:${rr}`, atr: round(atr), adx: round(adx, 1), volRatio: round(volRatio, 2),
    rsi3: round(rsi3, 1), support, resistance, structure: structure.structure,
    btcTrend: market.btcTrend, btcAligned, verdict: market.verdict,
    reasoning: [
      `${long ? 'Long' : 'Short'} bias: price ${long ? 'above' : 'below'} VWAP & EMA8.`,
      `ADX ${round(adx, 1)} ⇒ ${adx > 25 ? 'trending' : 'weak trend'}; volume ${round(volRatio, 2)}× avg.`,
      btcAligned ? `BTC ${market.btcTrend} supports the ${bias}.` : `⚠ BTC ${market.btcTrend} is against the ${bias} — size down.`,
      `Stop ${round(slDist / price * 100, 2)}% away; targeting 1:${rr} R:R.`,
    ].join(' '),
  };
}

/** Per-TF bias snapshot for the multi-TF card. */
export async function multiTfBias(symbol: string) {
  const out: Record<string, string> = {};
  await Promise.all(['5m', '15m', '1h', '4h'].map(async (tf) => {
    const c = await BinanceClient.klines(symbol, tf, 100).catch(() => []);
    out[tf] = c.length ? computeBiasOnTf(c) : 'n/a';
  }));
  return out;
}

/** Indicator snapshot card — price + all the indicators the bot scores on. */
export async function snapshot(symbol: string) {
  const candles = await BinanceClient.klines(symbol, '1m', 250);
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const vwap = calcVWAP(candles);
  const atr = calcATR(candles, 14);
  const macd = calcMACD(closes);
  const funding = await BinanceClient.funding(symbol).catch(() => 0);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sd20 = stdev(closes.slice(-20), sma20);
  return {
    price: round(price), vwap: round(vwap),
    ema8: round(calcEMA(closes, 8)), ema20: round(calcEMA(closes, 20)),
    ema50: round(calcEMA(closes, 50)), ema200: closes.length >= 200 ? round(calcEMA(closes, 200)) : null,
    sma20: round(sma20), sma50: round(sma50),
    rsi3: round(calcRSI(closes, 3), 1), rsi14: round(calcRSI(closes, 14), 1),
    macdHist: round(macd.histogram, 6), macdLine: round(macd.macd, 6), macdSignal: round(macd.signal, 6),
    atr: round(atr), atrPct: round((atr / price) * 100, 3),
    adx: round(calcADX(candles, 14), 1),
    bbUpper: round(sma20 + 2 * sd20), bbMid: round(sma20), bbLower: round(sma20 - 2 * sd20),
    volRatio: round(candles[candles.length - 1]!.volume / (avgVolume(candles, 20) || 1), 2),
    fundingPct: round(funding * 100, 4),
    distFromVwapPct: round(((price - vwap) / vwap) * 100, 2),
  };
}

function sma(arr: number[], n: number): number {
  const s = arr.slice(-n);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
}
function stdev(arr: number[], mean: number): number {
  if (!arr.length) return 0;
  return Math.sqrt(arr.reduce((a, c) => a + (c - mean) ** 2, 0) / arr.length);
}

/**
 * Classic floor-trader pivots from the previous completed day (H/L/C) + nearest
 * support/resistance, distance %, breakout/sweep zones and plain-English S/R
 * reasoning — the full "Support & Resistance" panel from the original chart page.
 */
export async function pivotLevels(symbol: string) {
  const daily = await BinanceClient.klines(symbol, '1d', 3).catch(() => []);
  if (daily.length < 2) return null;
  const prev = daily[daily.length - 2]!; // previous completed day
  const H = prev.high, L = prev.low, C = prev.close;
  const P = (H + L + C) / 3;
  const R1 = 2 * P - L, S1 = 2 * P - H;
  const R2 = P + (H - L), S2 = P - (H - L);
  const R3 = H + 2 * (P - L), S3 = L - 2 * (H - P);
  const price = (await BinanceClient.klines(symbol, '1m', 2).catch(() => []))[0]?.close ?? C;
  const dist = (lvl: number) => round(((lvl - price) / price) * 100, 2);
  const levels = [
    { label: 'R3', price: R3 }, { label: 'R2', price: R2 }, { label: 'R1', price: R1 },
    { label: 'P', price: P }, { label: 'S1', price: S1 }, { label: 'S2', price: S2 }, { label: 'S3', price: S3 },
  ].map((l) => ({ label: l.label, price: round(l.price), dist: dist(l.price) }));
  const above = levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price);
  const below = levels.filter((l) => l.price < price).sort((a, b) => b.price - a.price);
  const nearestRes = above[0] ?? null;
  const nearestSup = below[0] ?? null;
  const bandPct = nearestRes && nearestSup ? round(((nearestRes.price - nearestSup.price) / price) * 100, 2) : null;
  const reasoning: string[] = [];
  reasoning.push(price < P
    ? `Price is BELOW the daily pivot ${round(P)} — intraday floor-trader bias bearish.`
    : `Price is ABOVE the daily pivot ${round(P)} — intraday floor-trader bias bullish.`);
  if (nearestRes) reasoning.push(`Nearest resistance ${nearestRes.price} is ${nearestRes.dist >= 0 ? '+' : ''}${nearestRes.dist}% away — first upside target / breakout trigger.`);
  if (nearestSup) reasoning.push(`Nearest support ${nearestSup.price} is ${nearestSup.dist}% away — first downside target / stop reference.`);
  if (bandPct != null && bandPct < 1) reasoning.push(`Price sits in a ${bandPct}% band between support and resistance — tight coil, expect an imminent breakout.`);
  const breakout: string[] = [];
  if (nearestRes) breakout.push(`▲ Close above ${nearestRes.price} = bullish breakout → next ${above[1]?.price ?? R3}.`);
  if (nearestSup) breakout.push(`▼ Close below ${nearestSup.price} = bearish breakdown → next ${below[1]?.price ?? S3}.`);
  if (nearestSup) breakout.push(`💧 Wick below ${nearestSup.price} that reclaims = bullish liquidity sweep (long fuel).`);
  if (nearestRes) breakout.push(`💧 Wick above ${nearestRes.price} that rejects = bearish liquidity sweep (short fuel).`);
  return { price: round(price), pivot: round(P), levels, nearestRes, nearestSup, bandPct, reasoning, breakout };
}

/** Multi-timeframe trend + RSI(14) table with an up/down tally + overall verdict. */
export async function multiTfTable(symbol: string) {
  const tfs = ['1m', '5m', '15m', '1h', '4h'];
  const rows = await Promise.all(tfs.map(async (tf) => {
    const c = await BinanceClient.klines(symbol, tf, 100).catch(() => []);
    if (!c.length) return { tf, trend: 'n/a', rsi14: null as number | null };
    const bias = computeBiasOnTf(c);
    const trend = bias === 'long' ? 'BULLISH' : bias === 'short' ? 'BEARISH' : 'SIDEWAYS';
    return { tf, trend, rsi14: round(calcRSI(c.map((x) => x.close), 14), 1) };
  }));
  const up = rows.filter((r) => r.trend === 'BULLISH').length;
  const down = rows.filter((r) => r.trend === 'BEARISH').length;
  return { rows, up, down, overall: down > up ? 'BEARISH' : up > down ? 'BULLISH' : 'MIXED' };
}

/** Full 19-condition breakdown for the chart "Signal Conditions" card. */
export async function signalBreakdown(symbol: string, cfg: BotConfig | null, market: MarketStatus) {
  const candles = await BinanceClient.klines(symbol, '1m', 250);
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const ema8 = calcEMA(closes, 8);
  const vwap = calcVWAP(candles);
  const rsi3 = calcRSI(closes, 3);

  const tfBiases = await Promise.all(['5m', '15m', '1h'].map(async (tf) => {
    const c = await BinanceClient.klines(symbol, tf, 100).catch(() => []);
    return c.length ? computeBiasOnTf(c) : 'none';
  }));
  const baseDir = price > vwap && price > ema8 ? 'long' : price < vwap && price < ema8 ? 'short' : 'none';
  const agree = tfBiases.filter((b) => b === baseDir).length;
  const funding = await BinanceClient.funding(symbol).catch(() => 0);

  const ctx: StrategyCtx = {
    ...buildCandleCtx(candles), // SAME professional suite the live engine scores
    funding, multiTfAgree: { dir: baseDir as 'long' | 'short' | 'none', passed: agree, total: 3 },
    btcTrend: symbol === 'BTCUSDT' ? undefined : market.btcTrend,
    marketVerdict: market.verdict, fearGreed: { value: market.fearGreed.value },
    toggles: {
      adx: cfg?.useAdxFilter ?? true, ema: cfg?.useEmaTrend ?? true, rsi: cfg?.useRsi ?? true,
      volume: cfg?.useVolume ?? true, atr: cfg?.useAtr ?? true,
    },
  };
  const base = cfg?.scoreThreshold ?? 85;
  const threshold = cfg?.useAdaptiveLearning
    ? await effectiveThreshold(cfg.userId, base, symbol)
    : base;
  const r = runSafetyCheck(price, ema8, vwap, rsi3, ctx, threshold);
  // Snapshot fields the dashboard's SignalRow needs — computed from the SAME candles
  // so signalsOverview no longer fetches klines + funding a SECOND time per coin
  // (it used to call snapshot() in parallel with this). Same numbers, half the calls.
  const snap = {
    ema8: round(ema8), ema20: round(ctx.ema20 ?? 0), ema50: round(ctx.ema50 ?? 0),
    rsi3: round(rsi3, 1), rsi14: round(calcRSI(closes, 14), 1),
    volRatio: round(ctx.volRatio ?? 0, 2),
    atrPct: round((ctx.atrPct ?? 0) * 100, 3),
    adx: round(ctx.adx ?? 0, 1),
    macdHist: round(ctx.macd?.histogram ?? 0, 6),
    distFromVwapPct: round(((price - vwap) / vwap) * 100, 2),
  };
  return {
    bias: r.bias, score: r.score, threshold: r.threshold, allPass: r.allPass,
    earnedWeight: r.earnedWeight, totalWeight: r.totalWeight,
    conditions: r.results, criticalFails: r.criticalFails.map((c) => c.label),
    snap,
  };
}

/**
 * Rich per-coin signal overview for the dashboard "Live Signals" table, Top
 * Opportunity card, and the why/professional-read narrative. Combines the
 * indicator snapshot with the full 19-condition breakdown and a plain-English
 * "what's blocking" reason. Cached ~20s per (symbols·threshold·btcTrend) so a
 * dashboard refresh doesn't recompute klines for the whole watchlist each tick.
 */
export interface SignalRow {
  symbol: string; bias: 'long' | 'short' | 'none'; score: number; threshold: number; allPass: boolean;
  ema8: number | null; rsi3: number | null; rsi14: number | null; volRatio: number | null;
  vwapDeltaPct: number | null; atrPct: number | null; adx: number | null; macdHist: number | null;
  trend: 'up' | 'down' | 'mixed' | 'n/a'; blocking: string;
  // Full gating breakdown so the dashboard can explain EXACTLY why a trade is held:
  criticalFails: string[];                              // hard blocks — ANY one vetoes the trade regardless of score
  weakConditions: { label: string; weight: number }[]; // active non-critical checks that are failing (drag the score down)
  earnedWeight: number; totalWeight: number;            // score = earned / total × 100
}
const _signalsCache = new Map<string, { at: number; data: SignalRow[]; refreshing?: boolean }>();

async function computeSignals(symbols: string[], cfg: BotConfig | null, market: MarketStatus): Promise<SignalRow[]> {
  const rows: SignalRow[] = [];
  for (let i = 0; i < symbols.length; i += 6) {
    const batch = symbols.slice(i, i + 6);
    const part = await Promise.all(batch.map(async (symbol): Promise<SignalRow> => {
      // ONE pass per coin: signalBreakdown now also returns the snapshot fields the row
      // needs (from the same candles), so we no longer fetch klines + funding twice.
      const sig = await signalBreakdown(symbol, cfg, market).catch(() => null);
      if (!sig) {
        // Keep a row even when a symbol can't be analysed right now (e.g. a transient
        // klines failure) so the dashboard's coin count always matches the watchlist.
        return {
          symbol, bias: 'none', score: 0, threshold: cfg?.scoreThreshold ?? 85, allPass: false,
          ema8: null, rsi3: null, rsi14: null, volRatio: null, vwapDeltaPct: null,
          atrPct: null, adx: null, macdHist: null, trend: 'n/a', blocking: 'No market data yet',
          criticalFails: [], weakConditions: [], earnedWeight: 0, totalWeight: 0,
        };
      }
      const s = sig.snap;
      const trend = s.ema8 > s.ema20 && s.ema20 > s.ema50 ? 'up'
        : s.ema8 < s.ema20 && s.ema20 < s.ema50 ? 'down' : 'mixed';
      // Active, non-critical checks that are failing — sorted by weight so the biggest
      // score-drains come first. These are what's keeping the score below the bar.
      const weakConditions = [...sig.conditions]
        .filter((c) => c.active && !c.pass && !c.critical)
        .sort((a, b) => b.weight - a.weight)
        .map((c) => ({ label: c.label, weight: c.weight }));
      const topFail = weakConditions[0];
      const blocking = sig.bias === 'none' ? 'No directional bias (price between VWAP/EMA8)'
        : sig.criticalFails[0] ?? (sig.allPass ? '— would trade' : topFail?.label ?? 'Below score threshold');
      return {
        symbol, bias: sig.bias, score: sig.score, threshold: sig.threshold, allPass: sig.allPass,
        ema8: s.ema8, rsi3: s.rsi3, rsi14: s.rsi14, volRatio: s.volRatio, vwapDeltaPct: s.distFromVwapPct,
        atrPct: s.atrPct, adx: s.adx, macdHist: s.macdHist, trend, blocking,
        criticalFails: sig.criticalFails, weakConditions,
        earnedWeight: sig.earnedWeight, totalWeight: sig.totalWeight,
      };
    }));
    for (const r of part) rows.push(r);
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

export async function signalsOverview(symbols: string[], cfg: BotConfig | null, market: MarketStatus): Promise<SignalRow[]> {
  const key = `${symbols.join(',')}:${cfg?.scoreThreshold ?? 85}:${market.btcTrend}`;
  const cached = _signalsCache.get(key);
  if (cached && Date.now() - cached.at < 20_000) return cached.data;
  // Stale-while-revalidate: once we have ANY result for this key, serve it INSTANTLY
  // and refresh in the background. So only the very first load waits for the full
  // watchlist compute; every later refresh returns immediately (no 10–15s blank cards).
  if (cached) {
    if (!cached.refreshing) {
      cached.refreshing = true;
      void computeSignals(symbols, cfg, market)
        .then((data) => _signalsCache.set(key, { at: Date.now(), data }))
        .catch(() => { cached.refreshing = false; });
    }
    return cached.data;
  }
  const data = await computeSignals(symbols, cfg, market);
  _signalsCache.set(key, { at: Date.now(), data });
  return data;
}

/** Rule-based News & Research block (free market signals — NOT a paid feed). */
export async function newsResearch(symbol: string, market: MarketStatus) {
  const funding = await BinanceClient.funding(symbol).catch(() => 0);
  const fg = market.fearGreed.value;
  const score = (fg > 60 ? 1 : fg < 40 ? -1 : 0)
    + (market.btcTrend === 'bullish' ? 1 : market.btcTrend === 'bearish' ? -1 : 0)
    + (funding > 0.0003 ? -1 : funding < -0.0003 ? 1 : 0); // crowded longs = bearish contrarian
  const sentiment = score >= 1 ? 'Bullish' : score <= -1 ? 'Bearish' : 'Neutral';
  const headlines = [
    `Fear & Greed at ${fg} (${market.fearGreed.label}).`,
    `BTC trend is ${market.btcTrend}; market verdict ${market.verdict}.`,
    `${symbol} funding ${round(funding * 100, 4)}% — ${funding > 0.0003 ? 'longs crowded (caution)' : funding < -0.0003 ? 'shorts crowded (squeeze risk)' : 'balanced'}.`,
  ];
  return {
    sentiment, fearGreed: fg, fearGreedLabel: market.fearGreed.label,
    fundingPct: round(funding * 100, 4), btcTrend: market.btcTrend, verdict: market.verdict,
    whaleProxy: Math.abs(funding) > 0.0005 ? 'Elevated positioning' : 'Normal',
    headlines, note: 'Derived from free market signals (funding, Fear & Greed, BTC trend) — not a paid news/on-chain feed.',
  };
}

function round(n: number, dp = 6): number { const f = 10 ** dp; return Math.round(n * f) / f; }
