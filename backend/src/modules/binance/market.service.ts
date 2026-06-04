import fetch from 'node-fetch';
import { env } from '../../config/env.js';
import { BinanceClient } from './binance.client.js';
import { calcEMA, calcATR, avgVolume } from '../bot/indicators.js';

/**
 * SHARED (not per-tenant) market context: BTC trend, market verdict, funding,
 * Fear & Greed. Computed once and cached so 100 users' bots reuse a single
 * fetch instead of hammering Binance 100×. Feeds the strategy critical gates.
 */
let cached: { at: number; data: MarketStatus } | null = null;
const TTL_MS = 60_000;

export interface MarketStatus {
  btcTrend: 'bullish' | 'bearish' | 'sideways';
  verdict: 'SAFE' | 'MODERATE' | 'HIGH_RISK';
  fearGreed: { value: number; label: string };          // alternative.me — DRIVES the bot's gates
  fearGreedCmc: { value: number; label: string } | null; // CoinMarketCap — reference only (different methodology)
  btcAtrPct: number;
  updatedAt: number;
}

export async function getMarketStatus(): Promise<MarketStatus> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const [btc4h, fng, fngCmc] = await Promise.all([
    BinanceClient.klines('BTCUSDT', '4h', 100).catch(() => []),
    fetchFearGreed().catch(() => ({ value: 50, label: 'Neutral' })),
    fetchFearGreedCMC().catch(() => null),
  ]);

  let btcTrend: MarketStatus['btcTrend'] = 'sideways';
  let btcAtrPct = 0;
  let verdict: MarketStatus['verdict'] = 'MODERATE';

  if (btc4h.length >= 60) {
    const closes = btc4h.map((c) => c.close);
    const price = closes[closes.length - 1]!;
    const ema50 = calcEMA(closes, 50);
    const ema20 = calcEMA(closes, 20);
    btcTrend = price > ema20 && ema20 > ema50 ? 'bullish'
      : price < ema20 && ema20 < ema50 ? 'bearish' : 'sideways';
    btcAtrPct = calcATR(btc4h, 14) / price;
    const volRatio = btc4h[btc4h.length - 1]!.volume / (avgVolume(btc4h, 20) || 1);
    // crude regime verdict: high ATR + extreme F&G ⇒ risky
    const extreme = fng.value <= 20 || fng.value >= 80;
    verdict = btcAtrPct > 0.04 || extreme ? 'HIGH_RISK' : volRatio > 1.5 ? 'MODERATE' : 'SAFE';
  }

  const data: MarketStatus = { btcTrend, verdict, fearGreed: fng, fearGreedCmc: fngCmc, btcAtrPct, updatedAt: Date.now() };
  cached = { at: Date.now(), data };
  return data;
}

async function fetchFearGreed(): Promise<{ value: number; label: string }> {
  const res = await fetch('https://api.alternative.me/fng/?limit=1');
  const j = (await res.json()) as { data?: Array<{ value: string; value_classification: string }> };
  const d = j.data?.[0];
  return { value: Number(d?.value ?? 50), label: d?.value_classification ?? 'Neutral' };
}

/**
 * CoinMarketCap's OWN Fear & Greed index — shown on the dashboard alongside the
 * alternative.me number for reference. It uses a different methodology / update
 * cadence, so it routinely reads a few points apart (e.g. 23 vs 11). It is display
 * ONLY: the bot's HIGH_RISK gate still keys off alternative.me (`fetchFearGreed`).
 * Uses CMC's key-free website data-api (needs a browser UA, else it 404s to HTML).
 * Returns null on any failure so the dashboard simply falls back to alt.me.
 */
async function fetchFearGreedCMC(): Promise<{ value: number; label: string } | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 2 * 86_400; // 2-day window guarantees ≥1 point; take the latest
  const res = await fetch(
    `https://api.coinmarketcap.com/data-api/v3/fear-greed/chart?start=${start}&end=${end}`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } },
  );
  const j = (await res.json()) as { data?: { dataList?: Array<{ score?: number; name?: string }> } };
  const list = j.data?.dataList ?? [];
  const last = list[list.length - 1];
  if (!last || last.score == null) return null;
  return { value: Number(last.score), label: String(last.name ?? '') };
}

void env;
