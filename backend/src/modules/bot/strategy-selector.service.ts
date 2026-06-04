import fetch from 'node-fetch';
import { type MarketStatus } from '../binance/market.service.js';
import { snapshot } from './analysis.service.js';

/** Fear & Greed history (last 8 days) for the dashboard trend, cached 1h. */
let _fgCache: { at: number; data: { value: number; label: string; date: string }[] } | null = null;
export async function fearGreedHistory(): Promise<{ value: number; label: string; date: string }[]> {
  if (_fgCache && Date.now() - _fgCache.at < 3_600_000) return _fgCache.data;
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=8');
    const j = (await r.json()) as { data?: { value: string; value_classification: string; timestamp: string }[] };
    const data = (j.data ?? []).map((d) => ({
      value: Number(d.value), label: d.value_classification,
      date: new Date(Number(d.timestamp) * 1000).toISOString().slice(5, 10),
    })).reverse();
    _fgCache = { at: Date.now(), data };
    return data;
  } catch { return _fgCache?.data ?? []; }
}

/**
 * AI Strategy-Selection engine (§16–17, 22, 24). DETERMINISTIC, not black-box ML
 * — it classifies the current market regime from live indicators and picks the
 * institutional strategy family best suited to it, with a reason and confidence.
 * Nothing here auto-changes trading logic (§23): it's advisory/selection only.
 */

export type Regime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE' | 'WEAK';

export interface Strategy {
  id: string; name: string; category: string;
  regimes: Regime[];           // regimes this strategy is suited to
  implemented: boolean;        // already a live condition/gate in the engine
  note: string;
}

/** 50+ professional strategies/filters, tagged by category + suited regime. */
export const STRATEGY_LIBRARY: Strategy[] = [
  // ── Trend Following ──
  { id: 'ema_cross', name: 'EMA Crossover (8/20)', category: 'Trend Following', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Fast/slow EMA cross for trend entries.' },
  { id: 'multi_ema', name: 'Multi-EMA Alignment (8>20>50>200)', category: 'Trend Following', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Stacked EMAs confirm a clean trend.' },
  { id: 'supertrend', name: 'SuperTrend (ATR)', category: 'Trend Following', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'ATR-banded trend follower.' },
  { id: 'ma_ribbon', name: 'Moving-Average Ribbon', category: 'Trend Following', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'Ribbon expansion/compression for trend strength.' },
  { id: 'trend_strength', name: 'Trend Strength (ADX)', category: 'Trend Following', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'ADX>25 gate filters chop.' },
  { id: 'ichimoku', name: 'Ichimoku Cloud', category: 'Trend Following', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'Cloud + Tenkan/Kijun trend system.' },
  // ── Momentum ──
  { id: 'rsi_mom', name: 'RSI Momentum', category: 'Momentum', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'RSI thrust in trend direction.' },
  { id: 'macd_mom', name: 'MACD Momentum', category: 'Momentum', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'MACD histogram acceleration.' },
  { id: 'adx_mom', name: 'ADX Trend Strength', category: 'Momentum', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'VOLATILE'], implemented: true, note: 'Rising ADX = momentum building.' },
  { id: 'roc', name: 'Rate of Change (ROC)', category: 'Momentum', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'Price velocity over N bars.' },
  { id: 'mom_breakout', name: 'Momentum Breakout', category: 'Momentum', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'VOLATILE'], implemented: false, note: 'Breakout backed by momentum surge.' },
  { id: 'rsi_div', name: 'RSI Divergence', category: 'Momentum', regimes: ['RANGING', 'WEAK'], implemented: false, note: 'Reversal on price/RSI divergence.' },
  { id: 'macd_div', name: 'MACD Divergence', category: 'Momentum', regimes: ['RANGING', 'WEAK'], implemented: false, note: 'Reversal on price/MACD divergence.' },
  // ── Breakout ──
  { id: 'range_breakout', name: 'Range Breakout', category: 'Breakout', regimes: ['RANGING', 'VOLATILE'], implemented: false, note: 'Break of consolidation range.' },
  { id: 'vol_breakout', name: 'Volatility Breakout', category: 'Breakout', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'ATR-expansion breakout.' },
  { id: 'orb', name: 'Opening-Range Breakout', category: 'Breakout', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'Break of the session open range.' },
  { id: 'volume_breakout', name: 'Volume Breakout', category: 'Breakout', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Breakout confirmed by ≥1.3× volume.' },
  { id: 'hl_breakout', name: 'High-Low Breakout', category: 'Breakout', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Swing high/low break (S/R structure).' },
  { id: 'donchian', name: 'Donchian Channel Breakout', category: 'Breakout', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'VOLATILE'], implemented: false, note: 'N-bar channel breakout (turtle).' },
  // ── Pullback ──
  { id: 'trend_pullback', name: 'Trend Pullback', category: 'Pullback', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Buy dips / sell rallies within trend.' },
  { id: 'ema_retest', name: 'EMA Retest', category: 'Pullback', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Re-entry on EMA8/20 retest.' },
  { id: 'vwap_pullback', name: 'VWAP Pullback', category: 'Pullback', regimes: ['RANGING', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Mean-revert to VWAP then continue.' },
  { id: 'support_retest', name: 'Support Retest', category: 'Pullback', regimes: ['RANGING', 'TRENDING_UP'], implemented: true, note: 'Bounce off retested support.' },
  { id: 'breakout_retest', name: 'Breakout Retest', category: 'Pullback', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'Enter on retest of broken level.' },
  { id: 'fib_retrace', name: 'Fibonacci Retracement', category: 'Pullback', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: '0.5/0.618 pullback entries.' },
  // ── Smart Money Concepts ──
  { id: 'liquidity_sweep', name: 'Liquidity Sweep', category: 'Smart Money', regimes: ['VOLATILE', 'RANGING'], implemented: true, note: 'Bull/bear trap wick reversal.' },
  { id: 'order_blocks', name: 'Order Blocks', category: 'Smart Money', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING'], implemented: false, note: 'Institutional last-candle zones.' },
  { id: 'fvg', name: 'Fair Value Gaps', category: 'Smart Money', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'VOLATILE'], implemented: false, note: 'Imbalance gaps as targets/entries.' },
  { id: 'mss', name: 'Market Structure Shift (BOS/CHOCH)', category: 'Smart Money', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'HH-HL / LH-LL break of structure.' },
  { id: 'accum_dist', name: 'Accumulation / Distribution', category: 'Smart Money', regimes: ['RANGING', 'WEAK'], implemented: false, note: 'Wyckoff phase detection.' },
  // ── Volume & Order Flow ──
  { id: 'rvol', name: 'Relative Volume (RVOL)', category: 'Volume & Order Flow', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Volume vs 20-avg confirmation.' },
  { id: 'delta_volume', name: 'Delta Volume', category: 'Volume & Order Flow', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'Buy vs sell aggression (needs L2/agg-trades).' },
  { id: 'open_interest', name: 'Open Interest', category: 'Volume & Order Flow', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: false, note: 'OI rising into trend = conviction.' },
  { id: 'funding_rate', name: 'Funding Rate', category: 'Volume & Order Flow', regimes: ['RANGING', 'VOLATILE', 'WEAK'], implemented: true, note: 'Crowded funding = contrarian caution.' },
  { id: 'liquidations', name: 'Liquidation Analysis', category: 'Volume & Order Flow', regimes: ['VOLATILE'], implemented: false, note: 'Cascade zones (needs 3rd-party feed).' },
  // ── Market Sentiment ──
  { id: 'fear_greed', name: 'Fear & Greed Analysis', category: 'Market Sentiment', regimes: ['RANGING', 'VOLATILE', 'WEAK'], implemented: true, note: 'Extreme readings gate risk.' },
  { id: 'news_sentiment', name: 'News Sentiment', category: 'Market Sentiment', regimes: ['VOLATILE', 'WEAK'], implemented: false, note: 'Headline impact (needs news API).' },
  { id: 'social_sentiment', name: 'Social Sentiment', category: 'Market Sentiment', regimes: ['VOLATILE', 'WEAK'], implemented: false, note: 'Social volume/sentiment (needs feed).' },
  { id: 'btc_dominance', name: 'BTC Dominance', category: 'Market Sentiment', regimes: ['RANGING', 'WEAK'], implemented: false, note: 'Alt risk-on/off rotation.' },
  { id: 'stablecoin_flow', name: 'Stablecoin Flow', category: 'Market Sentiment', regimes: ['RANGING', 'WEAK'], implemented: false, note: 'Stablecoin supply as dry powder.' },
  { id: 'btc_trend_filter', name: 'BTC Trend Filter', category: 'Market Sentiment', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'VOLATILE'], implemented: true, note: 'Alt direction must align with BTC (critical gate).' },
  // ── Volatility ──
  { id: 'atr_expansion', name: 'ATR Expansion', category: 'Volatility', regimes: ['VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: 'Trade only with sufficient ATR.' },
  { id: 'bb_squeeze', name: 'Bollinger Squeeze', category: 'Volatility', regimes: ['RANGING', 'VOLATILE'], implemented: true, note: 'Low BB width → imminent breakout.' },
  { id: 'keltner_squeeze', name: 'Keltner/BB Squeeze Combo', category: 'Volatility', regimes: ['RANGING', 'VOLATILE'], implemented: false, note: 'TTM-squeeze style compression.' },
  { id: 'dynamic_risk', name: 'Dynamic Risk Adjustment', category: 'Volatility', regimes: ['VOLATILE', 'WEAK'], implemented: true, note: 'Size down / widen stops in high vol (margin guard).' },
  { id: 'bb_bounce', name: 'Bollinger Band Bounce', category: 'Volatility', regimes: ['RANGING'], implemented: false, note: 'Mean-revert off the bands in range.' },
  // ── Statistical & Quantitative ──
  { id: 'winrate_filter', name: 'Win-Rate Analysis', category: 'Statistical & Quant', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE', 'WEAK'], implemented: true, note: 'Per-coin win-rate gates selection.' },
  { id: 'expected_value', name: 'Expected-Value Analysis', category: 'Statistical & Quant', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE', 'WEAK'], implemented: false, note: 'EV = winRate·avgWin − lossRate·avgLoss.' },
  { id: 'vol_regime', name: 'Volatility Regime Detection', category: 'Statistical & Quant', regimes: ['VOLATILE', 'RANGING', 'WEAK'], implemented: true, note: 'This very classifier (regime gate).' },
  { id: 'trade_quality', name: 'Trade Quality Scoring', category: 'Statistical & Quant', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE', 'WEAK'], implemented: true, note: '19-condition weighted score ≥ threshold.' },
  { id: 'prob_selection', name: 'Probability-Based Selection', category: 'Statistical & Quant', regimes: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE', 'WEAK'], implemented: true, note: 'Rank setups, take highest-confidence.' },
  { id: 'multi_tf_conf', name: 'Multi-Timeframe Confirmation', category: 'Statistical & Quant', regimes: ['TRENDING_UP', 'TRENDING_DOWN'], implemented: true, note: '5m/15m/1h agreement gate.' },
];

const REGIME_LABEL: Record<Regime, string> = {
  TRENDING_UP: 'Trending ↑', TRENDING_DOWN: 'Trending ↓', RANGING: 'Ranging / consolidation',
  VOLATILE: 'High volatility', WEAK: 'Weak / choppy',
};
const PRIMARY: Record<Regime, string> = {
  TRENDING_UP: 'multi_ema', TRENDING_DOWN: 'multi_ema', RANGING: 'vwap_pullback',
  VOLATILE: 'bb_squeeze', WEAK: 'prob_selection',
};

/** Classify the live market regime from BTC indicators + market verdict. */
export async function detectRegime(market: MarketStatus): Promise<{ regime: Regime; confidence: number; metrics: { adx: number; atrPct: number; emaTrend: string; fearGreed: number } }> {
  const btc = await snapshot('BTCUSDT').catch(() => null);
  const adx = btc?.adx ?? 0;
  const atrPct = (market.btcAtrPct ?? 0) * 100;
  const emaUp = btc ? btc.ema8 > btc.ema50 : market.btcTrend === 'bullish';
  const emaDown = btc ? btc.ema8 < btc.ema50 : market.btcTrend === 'bearish';
  const emaTrend = emaUp ? 'up' : emaDown ? 'down' : 'flat';

  let regime: Regime; let confidence: number;
  if (market.verdict === 'HIGH_RISK' || atrPct > 2.5) {
    regime = 'VOLATILE'; confidence = Math.min(92, 60 + atrPct * 8);
  } else if (adx >= 25 && emaUp) {
    regime = 'TRENDING_UP'; confidence = Math.min(95, 55 + (adx - 25) * 2);
  } else if (adx >= 25 && emaDown) {
    regime = 'TRENDING_DOWN'; confidence = Math.min(95, 55 + (adx - 25) * 2);
  } else if (adx < 18) {
    regime = 'RANGING'; confidence = Math.min(85, 50 + (18 - adx) * 3);
  } else {
    regime = 'WEAK'; confidence = 45 + (25 - adx);
  }
  return { regime, confidence: Math.round(confidence), metrics: { adx: +adx.toFixed(1), atrPct: +atrPct.toFixed(2), emaTrend, fearGreed: market.fearGreed.value } };
}

/** Pick the active strategy/playbook for the current regime + a reason. */
export async function selectStrategy(market: MarketStatus) {
  const { regime, confidence, metrics } = await detectRegime(market);
  const active = STRATEGY_LIBRARY.filter((s) => s.regimes.includes(regime));
  const avoid = STRATEGY_LIBRARY.filter((s) => !s.regimes.includes(regime)
    && ((regime === 'RANGING' && s.category === 'Trend Following')
      || ((regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') && (s.id === 'bb_bounce' || s.id === 'rsi_div' || s.id === 'macd_div'))
      || (regime === 'WEAK' && s.category !== 'Statistical & Quant' && s.category !== 'Market Sentiment')));
  const primary = STRATEGY_LIBRARY.find((s) => s.id === PRIMARY[regime])!;

  const reasonByRegime: Record<Regime, string> = {
    TRENDING_UP: `BTC is trending up (ADX ${metrics.adx}, EMAs stacked up). Favour trend-following + pullback continuation; avoid mean-reversion/range plays.`,
    TRENDING_DOWN: `BTC is trending down (ADX ${metrics.adx}, EMAs stacked down). Favour short-side trend-following + rallies-to-sell; alt LONGs are gated.`,
    RANGING: `BTC is ranging (ADX ${metrics.adx} < 18). Favour VWAP/support pullbacks and range/Bollinger breakouts; trend-following whipsaws here.`,
    VOLATILE: `High volatility (ATR ${metrics.atrPct}%${market.verdict === 'HIGH_RISK' ? ', HIGH_RISK verdict' : ''}). Favour volatility breakouts + liquidity sweeps, size down (dynamic risk).`,
    WEAK: `Weak/choppy (ADX ${metrics.adx}). No clean edge — quality bar + probability selection only; mostly stand aside.`,
  };

  const byCategory: Record<string, number> = {};
  for (const s of STRATEGY_LIBRARY) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;

  return {
    regime, regimeLabel: REGIME_LABEL[regime], confidence, metrics,
    primary: { id: primary.id, name: primary.name, category: primary.category, note: primary.note },
    active: active.map((s) => ({ id: s.id, name: s.name, category: s.category, implemented: s.implemented })),
    avoid: avoid.slice(0, 6).map((s) => s.name),
    reason: reasonByRegime[regime],
    library: { total: STRATEGY_LIBRARY.length, implemented: STRATEGY_LIBRARY.filter((s) => s.implemented).length, byCategory },
  };
}
