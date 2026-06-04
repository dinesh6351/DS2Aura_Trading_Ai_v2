import type { Candle } from '../binance/binance.client.js';
import type { StrategyCtx } from './strategy.js';
import {
  calcEMA, calcATR, calcADX, calcMACD, avgVolume, emaSlope,
  detectCandlePattern, findSwingLevels, detectMarketStructure,
  detectBreakout, detectLiquiditySweep,
} from './indicators.js';

/**
 * Builds the candle-derived portion of the StrategyCtx — the trend-pullback
 * confluence set scored by runSafetyCheck. SHARED by the live engine and the
 * chart's "Signal Conditions" breakdown so both evaluate the exact same set
 * (no drift). The caller merges in async/market fields: funding, multiTfAgree,
 * btcTrend, marketVerdict, fearGreed and the user's toggles.
 *
 * Deliberately a SMALL, category-diverse set (trend · momentum · volatility ·
 * volume · structure). Stacking many correlated momentum oscillators here would
 * only score high at exhaustion tops — see the note in strategy.ts.
 */
export function buildCandleCtx(candles: Candle[]): StrategyCtx {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1] ?? 0;
  const atr = calcATR(candles, 14);
  const swing = findSwingLevels(candles, 50);
  const volRatio = (candles[candles.length - 1]?.volume ?? 0) / (avgVolume(candles, 20) || 1);
  return {
    ema20: calcEMA(closes, 20),
    ema50: calcEMA(closes, 50),
    ema200: closes.length >= 200 ? calcEMA(closes, 200) : undefined,
    ema50Slope: emaSlope(closes, 50),
    atrPct: price > 0 ? atr / price : 0,
    volRatio,
    macd: calcMACD(closes),
    adx: calcADX(candles, 14),
    pattern: detectCandlePattern(candles),
    swingLevels: swing,
    marketStructure: detectMarketStructure(candles),
    breakout: detectBreakout(candles, swing, volRatio),
    sweep: detectLiquiditySweep(candles, swing),
  };
}
