/**
 * Strategy engine — faithful TypeScript port of bot.js `runSafetyCheck`.
 *
 * The 19-condition model: 15 weighted conditions summing to 100 + 4-5 critical
 * pass/fail gates. A trade fires only when bias is directional, score ≥ the
 * (per-user) threshold, AND every critical gate passes.
 *
 * This is a TREND-PULLBACK system (buy dips in an uptrend / sell rallies in a
 * downtrend), which is why RSI(3) carries real weight: the highest-probability
 * entry is a shallow pullback INTO an established trend, not a fully-extended
 * push where every oscillator is already maxed out (that's the reversal zone).
 * Stacking many correlated momentum indicators inverts this — it only scores
 * high at exhaustion tops — so we deliberately keep a small, category-diverse
 * confluence set (trend · momentum · volatility · volume · structure).
 *
 * The SaaS change vs the single-user bot: `scoreThreshold` and the strategy
 * toggles come from each tenant's BotConfig, not a global env var.
 */

export interface StrategyCtx {
  ema20?: number; ema50?: number; ema200?: number; ema50Slope?: number;
  atrPct?: number; volRatio?: number;
  macd?: { histogram: number };
  adx?: number;
  pattern?: { pattern: string | null; bullish: boolean; bearish: boolean };
  swingLevels?: { support: number | null; resistance: number | null };
  spreadPct?: number;
  marketVerdict?: string;       // SAFE | MODERATE | HIGH_RISK
  btcTrend?: string;            // bullish | bearish | sideways
  funding?: number;
  multiTfAgree?: { dir: 'long' | 'short' | 'none'; passed: number; total: number };
  marketStructure?: { structure: string; uptrend: boolean; downtrend: boolean };
  breakout?: { breakoutUp: boolean; breakoutDown: boolean };
  sweep?: { sweepLow: boolean; sweepHigh: boolean };
  fearGreed?: { value: number };
  // toggles (default on) — let users disable individual filters from the dashboard
  toggles?: { adx?: boolean; ema?: boolean; rsi?: boolean; volume?: boolean; atr?: boolean };
}

export interface ConditionResult {
  label: string; pass: boolean; weight: number; critical: boolean;
  active: boolean; // true = counted toward the score now (enabled + data present + directional bias)
}

export interface SafetyResult {
  results: ConditionResult[];
  allPass: boolean;
  bias: 'long' | 'short' | 'none';
  score: number;
  threshold: number;
  earnedWeight: number;
  totalWeight: number;
  criticalFails: ConditionResult[];
}

export function runSafetyCheck(
  price: number, ema8: number, vwap: number, rsi3: number,
  ctx: StrategyCtx, scoreThreshold: number,
): SafetyResult {
  const results: ConditionResult[] = [];
  const {
    ema20, ema50, ema200, ema50Slope, atrPct, volRatio, macd, adx, pattern,
    swingLevels, spreadPct, marketVerdict, btcTrend, funding, multiTfAgree,
    marketStructure, breakout, sweep, fearGreed, toggles = {},
  } = ctx;
  const t = { adx: true, ema: true, rsi: true, volume: true, atr: true, ...toggles };

  const bullish = price > vwap && price > ema8;
  const bearish = price < vwap && price < ema8;
  const dir: 'long' | 'short' | 'none' = bullish ? 'long' : bearish ? 'short' : 'none';
  const up = dir === 'long';
  const directional = dir !== 'none';

  // EVERY condition/strategy is recorded so the chart can show the full checklist.
  // Only ACTIVE ones count toward the score — active = directional bias AND the
  // condition is enabled (toggle) AND its data is present. This keeps the score
  // identical to before (which simply skipped the inactive ones).
  const check = (label: string, pass: boolean, weight: number, critical = false, enabled = true) =>
    results.push({ label, pass, weight, critical, active: directional && enabled });

  const room = swingLevels
    ? (up && swingLevels.resistance != null ? ((swingLevels.resistance - price) / price) * 100
      : !up && swingLevels.support != null ? ((price - swingLevels.support) / price) * 100 : null)
    : null;
  const distFromVWAP = Math.abs((price - vwap) / vwap) * 100;

  // Trend / structure (40 pts)
  check('Price vs VWAP', up ? price > vwap : price < vwap, 8);
  check('EMA(8) alignment', up ? price > ema8 : price < ema8, 5, false, t.ema);
  check('EMA(20) alignment', up ? price > (ema20 ?? 0) : price < (ema20 ?? 0), 5, false, t.ema && ema20 != null);
  check('EMA(50) alignment', up ? price > (ema50 ?? 0) : price < (ema50 ?? 0), 7, false, t.ema && ema50 != null);
  check('EMA(200) major trend', up ? price > (ema200 ?? 0) : price < (ema200 ?? 0), 8, false, t.ema && ema200 != null);
  check('EMA(50) slope', up ? (ema50Slope ?? 0) > 0 : (ema50Slope ?? 0) < 0, 7, false, t.ema && ema50Slope != null);
  // Pullback / momentum (20 pts)
  check('RSI(3) pullback', up ? rsi3 < 30 : rsi3 > 70, 10, false, t.rsi);
  check('MACD histogram sign', up ? (macd?.histogram ?? 0) > 0 : (macd?.histogram ?? 0) < 0, 10, false, macd != null);
  // Market regime (20 pts)
  check('Not overextended (<1.5% from VWAP)', distFromVWAP < 1.5, 6);
  check('ATR ≥ 0.08% (alive)', (atrPct ?? 0) >= 0.0008, 4, false, t.atr && atrPct != null);
  check('Volume ≥ 1.2× avg', (volRatio ?? 0) >= 1.2, 5, false, t.volume && volRatio != null);
  check('ADX > 25 (trending)', (adx ?? 0) > 25, 5, false, t.adx && adx != null);
  // Pattern / structure (10 pts)
  check('Candle pattern', up ? !!pattern?.bullish : !!pattern?.bearish, 5, false, !!pattern?.pattern);
  check('S/R proximity (≥0.5% room)', (room ?? 0) >= 0.5, 5, false, room != null);
  // Higher-confidence layers (25 pts)
  check('Multi-TF agreement', !!multiTfAgree && multiTfAgree.dir === dir && multiTfAgree.passed >= 2, 10, false, !!multiTfAgree);
  check('Market structure', up ? !!marketStructure?.uptrend : !!marketStructure?.downtrend, 6, false, !!marketStructure);
  check('S/R breakout', up ? !!breakout?.breakoutUp : !!breakout?.breakoutDown, 4, false, !!breakout);
  check('Liquidity sweep', up ? !!sweep?.sweepLow : !!sweep?.sweepHigh, 3, false, !!sweep);
  check('Fear & Greed', up ? (fearGreed?.value ?? 50) <= 75 : (fearGreed?.value ?? 50) >= 25, 2, false, !!fearGreed && typeof fearGreed.value === 'number');
  // Critical gates
  check('Spread ≤ 0.1%', (spreadPct ?? 1) <= 0.001, 0, true, spreadPct != null);
  check('Market verdict ≠ HIGH_RISK', marketVerdict !== 'HIGH_RISK', 0, true, !!marketVerdict);
  check(up ? 'BTC not bearish (alt-long gate)' : 'BTC not bullish (alt-short gate)',
    up ? btcTrend !== 'bearish' : btcTrend !== 'bullish', 0, true, !!btcTrend);
  check('Funding < 0.05%', Math.abs(funding ?? 0) < 0.0005, 0, true, funding != null);
  check('ADX > 20 (real trend, not chop)', (adx ?? 0) > 20, 0, true, t.adx && adx != null);

  const totalWeight = results.filter((r) => !r.critical && r.active).reduce((s, r) => s + r.weight, 0);
  const earnedWeight = results.filter((r) => !r.critical && r.active && r.pass).reduce((s, r) => s + r.weight, 0);
  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  const criticalFails = results.filter((r) => r.critical && r.active && !r.pass);
  const allPass = directional && criticalFails.length === 0 && score >= scoreThreshold;

  return { results, allPass, bias: dir, score, threshold: scoreThreshold, earnedWeight, totalWeight, criticalFails };
}
