import type { Candle } from '../binance/binance.client.js';

/**
 * Pure technical-indicator math, ported 1:1 from the original bot.js so the
 * SaaS engine produces identical signals. No side effects, no I/O.
 */

export function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i]! * k + ema * (1 - k);
  return ema;
}

export function emaSeries(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(ema);
  for (let i = period; i < closes.length; i++) { ema = closes[i]! * k + ema * (1 - k); out.push(ema); }
  return out;
}

export function emaSlope(closes: number[], period: number, lookback = 5): number {
  const series = emaSeries(closes, period);
  if (series.length < lookback + 1) return 0;
  const now = series[series.length - 1]!;
  const past = series[series.length - 1 - lookback]!;
  return (now - past) / past;
}

export function calcMACD(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  const n = Math.min(fastE.length, slowE.length);
  const macdLine: number[] = [];
  for (let i = 0; i < n; i++) macdLine.push(fastE[fastE.length - n + i]! - slowE[slowE.length - n + i]!);
  const signalLine = emaSeries(macdLine, signalPeriod);
  const macd = macdLine[macdLine.length - 1] ?? 0;
  const signal = signalLine[signalLine.length - 1] ?? 0;
  return { macd, signal, histogram: macd - signal };
}

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function avgVolume(candles: Candle[], n = 20): number {
  const vols = candles.slice(-n).map((c) => c.volume);
  return vols.reduce((a, b) => a + b, 0) / (vols.length || 1);
}

export function calcADX(candles: Candle[], period = 14): number {
  if (candles.length < period * 2) return 0;
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    const up = c.high - p.high, down = p.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const smooth = (arr: number[]) => arr.slice(-period).reduce((a, b) => a + b, 0);
  const atr = smooth(tr) || 1;
  const pDI = (smooth(plusDM) / atr) * 100;
  const mDI = (smooth(minusDM) / atr) * 100;
  const dx = (Math.abs(pDI - mDI) / (pDI + mDI || 1)) * 100;
  return dx;
}

export function calcVWAP(candles: Candle[]): number {
  let pv = 0, vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume; vol += c.volume;
  }
  return vol > 0 ? pv / vol : candles[candles.length - 1]?.close ?? 0;
}

export function detectCandlePattern(candles: Candle[]) {
  const c = candles[candles.length - 1], p = candles[candles.length - 2];
  if (!c || !p) return { pattern: null as string | null, bullish: false, bearish: false };
  const body = Math.abs(c.close - c.open), range = c.high - c.low || 1;
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  // Bullish/bearish engulfing
  if (c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close)
    return { pattern: 'bullish_engulfing', bullish: true, bearish: false };
  if (c.close < c.open && p.close > p.open && c.open >= p.close && c.close <= p.open)
    return { pattern: 'bearish_engulfing', bullish: false, bearish: true };
  // Hammer / shooting star
  if (lowerWick > body * 2 && upperWick < body) return { pattern: 'hammer', bullish: true, bearish: false };
  if (upperWick > body * 2 && lowerWick < body) return { pattern: 'shooting_star', bullish: false, bearish: true };
  void range;
  return { pattern: null, bullish: false, bearish: false };
}

export function findSwingLevels(candles: Candle[], lookback = 50) {
  const slice = candles.slice(-lookback);
  if (!slice.length) return { support: null as number | null, resistance: null as number | null };
  const highs = slice.map((c) => c.high), lows = slice.map((c) => c.low);
  return { support: Math.min(...lows), resistance: Math.max(...highs) };
}

export function detectMarketStructure(candles: Candle[]) {
  const s = candles.slice(-20);
  if (s.length < 10) return { structure: 'unknown', uptrend: false, downtrend: false };
  const firstHalf = s.slice(0, s.length / 2), secondHalf = s.slice(s.length / 2);
  const maxA = Math.max(...firstHalf.map((c) => c.high)), maxB = Math.max(...secondHalf.map((c) => c.high));
  const minA = Math.min(...firstHalf.map((c) => c.low)), minB = Math.min(...secondHalf.map((c) => c.low));
  const uptrend = maxB > maxA && minB > minA;
  const downtrend = maxB < maxA && minB < minA;
  return { structure: uptrend ? 'HH-HL' : downtrend ? 'LH-LL' : 'range', uptrend, downtrend };
}

export function computeBiasOnTf(candles: Candle[]): 'long' | 'short' | 'none' {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const ema8 = calcEMA(closes, 8);
  const vwap = calcVWAP(candles);
  if (price > vwap && price > ema8) return 'long';
  if (price < vwap && price < ema8) return 'short';
  return 'none';
}

/* ════════════════════════════════════════════════════════════════════════════
 * Extended professional indicator suite — adds the confirmations a discretionary
 * trader stacks before pulling the trigger: oscillators (Stoch, StochRSI, CCI,
 * Williams %R, MFI), volume (OBV, CMF, volume spike), momentum (ROC, AO,
 * Momentum), volatility bands (Bollinger, Keltner, Donchian, VWAP σ-bands) and
 * trend-followers (Supertrend, Parabolic SAR, Ichimoku, +DI/−DI, EMA crosses).
 * All pure functions over the candle array — no I/O.
 * ════════════════════════════════════════════════════════════════════════════ */

export function bollinger(closes: number[], period = 20, mult = 2) {
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / (slice.length || 1);
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  const price = closes[closes.length - 1] ?? mid;
  return { upper, mid, lower, width: mid > 0 ? (upper - lower) / mid : 0, pctB: upper > lower ? (price - lower) / (upper - lower) : 0.5 };
}

export function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3) {
  if (candles.length < kPeriod) return { k: 50, d: 50 };
  const ks: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const w = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...w.map((c) => c.high)), low = Math.min(...w.map((c) => c.low));
    ks.push(high > low ? ((candles[i]!.close - low) / (high - low)) * 100 : 50);
  }
  const k = ks[ks.length - 1]!;
  const d = ks.slice(-dPeriod).reduce((a, b) => a + b, 0) / Math.min(dPeriod, ks.length);
  return { k, d };
}

export function rsiSeries(closes: number[], period = 14): number[] {
  if (closes.length <= period) return [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const dd = closes[i]! - closes[i - 1]!; if (dd >= 0) gain += dd; else loss -= dd; }
  let avgGain = gain / period, avgLoss = loss / period;
  const out: number[] = [avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)];
  for (let i = period + 1; i < closes.length; i++) {
    const dd = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + (dd > 0 ? dd : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (dd < 0 ? -dd : 0)) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export function stochRSI(closes: number[], period = 14, smooth = 3) {
  const rsis = rsiSeries(closes, period);
  if (rsis.length < period) return { k: 50, d: 50 };
  const ks: number[] = [];
  for (let i = Math.max(period - 1, rsis.length - smooth); i < rsis.length; i++) {
    const w = rsis.slice(i - period + 1, i + 1);
    const hi = Math.max(...w), lo = Math.min(...w);
    ks.push(hi > lo ? ((rsis[i]! - lo) / (hi - lo)) * 100 : 50);
  }
  if (!ks.length) return { k: 50, d: 50 };
  return { k: ks[ks.length - 1]!, d: ks.reduce((a, b) => a + b, 0) / ks.length };
}

export function williamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50;
  const w = candles.slice(-period);
  const high = Math.max(...w.map((c) => c.high)), low = Math.min(...w.map((c) => c.low));
  const close = candles[candles.length - 1]!.close;
  return high > low ? ((high - close) / (high - low)) * -100 : -50;
}

export function cci(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const w = candles.slice(-period);
  const tp = w.map((c) => (c.high + c.low + c.close) / 3);
  const mean = tp.reduce((a, b) => a + b, 0) / tp.length;
  const md = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / tp.length;
  return md > 0 ? (tp[tp.length - 1]! - mean) / (0.015 * md) : 0;
}

export function mfi(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  const w = candles.slice(-(period + 1));
  let pos = 0, neg = 0;
  for (let i = 1; i < w.length; i++) {
    const tpNow = (w[i]!.high + w[i]!.low + w[i]!.close) / 3;
    const tpPrev = (w[i - 1]!.high + w[i - 1]!.low + w[i - 1]!.close) / 3;
    const mf = tpNow * w[i]!.volume;
    if (tpNow > tpPrev) pos += mf; else if (tpNow < tpPrev) neg += mf;
  }
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

export function obvSlope(candles: Candle[], lookback = 20): number {
  if (candles.length < lookback + 1) return 0;
  const series: number[] = [];
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    const dd = candles[i]!.close - candles[i - 1]!.close;
    obv += dd > 0 ? candles[i]!.volume : dd < 0 ? -candles[i]!.volume : 0;
    series.push(obv);
  }
  const now = series[series.length - 1]!;
  const past = series[series.length - 1 - lookback] ?? series[0]!;
  return now - past;
}

export function cmf(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const w = candles.slice(-period);
  let mfv = 0, vol = 0;
  for (const c of w) {
    const range = c.high - c.low;
    mfv += (range > 0 ? ((c.close - c.low) - (c.high - c.close)) / range : 0) * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? mfv / vol : 0;
}

export function roc(closes: number[], period = 12): number {
  if (closes.length < period + 1) return 0;
  const past = closes[closes.length - 1 - period]!;
  return past !== 0 ? ((closes[closes.length - 1]! - past) / past) * 100 : 0;
}

export function momentum(closes: number[], period = 10): number {
  if (closes.length < period + 1) return 0;
  return closes[closes.length - 1]! - closes[closes.length - 1 - period]!;
}

export function awesomeOscillator(candles: Candle[]): number {
  if (candles.length < 34) return 0;
  const median = candles.map((c) => (c.high + c.low) / 2);
  const sma = (arr: number[], n: number) => { const s = arr.slice(-n); return s.reduce((a, b) => a + b, 0) / (s.length || 1); };
  return sma(median, 5) - sma(median, 34);
}

export function parabolicSAR(candles: Candle[], step = 0.02, max = 0.2): { isLong: boolean; sar: number } {
  if (candles.length < 5) return { isLong: true, sar: candles[candles.length - 1]?.close ?? 0 };
  let isLong = candles[1]!.close > candles[0]!.close;
  let sar = isLong ? Math.min(candles[0]!.low, candles[1]!.low) : Math.max(candles[0]!.high, candles[1]!.high);
  let ep = isLong ? candles[1]!.high : candles[1]!.low;
  let af = step;
  for (let i = 2; i < candles.length; i++) {
    const c = candles[i]!;
    sar += af * (ep - sar);
    if (isLong) {
      if (c.low < sar) { isLong = false; sar = ep; ep = c.low; af = step; }
      else if (c.high > ep) { ep = c.high; af = Math.min(af + step, max); }
    } else {
      if (c.high > sar) { isLong = true; sar = ep; ep = c.high; af = step; }
      else if (c.low < ep) { ep = c.low; af = Math.min(af + step, max); }
    }
  }
  return { isLong, sar };
}

export function supertrend(candles: Candle[], period = 10, mult = 3): { dir: 'up' | 'down' } {
  if (candles.length < period + 2) return { dir: 'up' };
  const atr = calcATR(candles, period);
  let dir: 'up' | 'down' = 'up';
  let prevUpper = Infinity, prevLower = -Infinity, prevClose = candles[0]!.close;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const mid = (c.high + c.low) / 2;
    let ub = mid + mult * atr, lb = mid - mult * atr;
    ub = (ub < prevUpper || prevClose > prevUpper) ? ub : prevUpper;
    lb = (lb > prevLower || prevClose < prevLower) ? lb : prevLower;
    if (c.close > prevUpper) dir = 'up'; else if (c.close < prevLower) dir = 'down';
    prevUpper = ub; prevLower = lb; prevClose = c.close;
  }
  return { dir };
}

export function ichimoku(candles: Candle[]) {
  if (candles.length < 52) return { aboveCloud: false, belowCloud: false, tkBull: false, tkBear: false, priceAboveKijun: false };
  const hh = (n: number) => Math.max(...candles.slice(-n).map((c) => c.high));
  const ll = (n: number) => Math.min(...candles.slice(-n).map((c) => c.low));
  const tenkan = (hh(9) + ll(9)) / 2, kijun = (hh(26) + ll(26)) / 2;
  const spanA = (tenkan + kijun) / 2, spanB = (hh(52) + ll(52)) / 2;
  const price = candles[candles.length - 1]!.close;
  return {
    aboveCloud: price > Math.max(spanA, spanB), belowCloud: price < Math.min(spanA, spanB),
    tkBull: tenkan > kijun, tkBear: tenkan < kijun, priceAboveKijun: price > kijun,
  };
}

export function donchian(candles: Candle[], period = 20) {
  const w = candles.slice(-period);
  const upper = Math.max(...w.map((c) => c.high)), lower = Math.min(...w.map((c) => c.low));
  return { upper, lower, mid: (upper + lower) / 2 };
}

export function keltner(closes: number[], candles: Candle[], period = 20, mult = 2) {
  const mid = calcEMA(closes, period), atr = calcATR(candles, period);
  return { upper: mid + mult * atr, mid, lower: mid - mult * atr };
}

export function directionalIndex(candles: Candle[], period = 14) {
  if (candles.length < period * 2) return { plusDI: 0, minusDI: 0 };
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    const up = c.high - p.high, down = p.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const smooth = (a: number[]) => a.slice(-period).reduce((x, y) => x + y, 0);
  const atr = smooth(tr) || 1;
  return { plusDI: (smooth(plusDM) / atr) * 100, minusDI: (smooth(minusDM) / atr) * 100 };
}

export function consecutiveDir(candles: Candle[]) {
  let up = 0, down = 0;
  for (let i = candles.length - 1; i >= 0; i--) { if (candles[i]!.close > candles[i]!.open) up++; else break; }
  for (let i = candles.length - 1; i >= 0; i--) { if (candles[i]!.close < candles[i]!.open) down++; else break; }
  return { up, down };
}

export function vwapBands(candles: Candle[], mult = 2) {
  const vwap = calcVWAP(candles);
  const tps = candles.map((c) => (c.high + c.low + c.close) / 3);
  const mean = tps.reduce((a, b) => a + b, 0) / (tps.length || 1);
  const sd = Math.sqrt(tps.reduce((a, b) => a + (b - mean) ** 2, 0) / (tps.length || 1));
  return { upper: vwap + mult * sd, lower: vwap - mult * sd, vwap };
}

export function emaCrosses(closes: number[]) {
  const e8 = emaSeries(closes, 8), e20 = emaSeries(closes, 20), e50 = emaSeries(closes, 50), e200 = emaSeries(closes, 200);
  const recentCross = (a: number[], b: number[], up: boolean, look = 3): boolean => {
    const n = Math.min(a.length, b.length);
    if (n < look + 1) return false;
    const aN = a.slice(-n), bN = b.slice(-n);
    const now = aN[aN.length - 1]! - bN[bN.length - 1]!;
    const past = aN[aN.length - 1 - look]! - bN[bN.length - 1 - look]!;
    return up ? (past <= 0 && now > 0) : (past >= 0 && now < 0);
  };
  return {
    fastBull: recentCross(e8, e20, true), fastBear: recentCross(e8, e20, false),
    goldenRecent: e200.length ? recentCross(e50, e200, true, 5) : false,
    deathRecent: e200.length ? recentCross(e50, e200, false, 5) : false,
  };
}

export function volumeSpike(candles: Candle[], n = 20, mult = 2): boolean {
  const last = candles[candles.length - 1];
  if (!last) return false;
  const avg = avgVolume(candles, n);
  return avg > 0 && last.volume >= avg * mult;
}

export function detectBreakout(candles: Candle[], swing: { support: number | null; resistance: number | null }, volRatio: number) {
  const last = candles[candles.length - 1];
  if (!last) return { breakoutUp: false, breakoutDown: false };
  const range = last.high - last.low, body = Math.abs(last.close - last.open);
  const strongBody = range > 0 && body / range > 0.5, volOK = volRatio >= 1.3;
  return {
    breakoutUp: swing.resistance != null && last.close > swing.resistance && strongBody && volOK,
    breakoutDown: swing.support != null && last.close < swing.support && strongBody && volOK,
  };
}

export function detectLiquiditySweep(candles: Candle[], swing: { support: number | null; resistance: number | null }) {
  const last = candles[candles.length - 1];
  if (!last) return { sweepLow: false, sweepHigh: false };
  return {
    sweepLow: swing.support != null && last.low < swing.support && last.close > swing.support,
    sweepHigh: swing.resistance != null && last.high > swing.resistance && last.close < swing.resistance,
  };
}
