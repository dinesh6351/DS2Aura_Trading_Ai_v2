import fetch from 'node-fetch';
import { hmacSha256 } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { Errors, AppError } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

/** True if a thrown exchange error is Binance -4120 ("use the Algo Order API"),
 *  the documented signal to retry a trigger order with reduceOnly+quantity. */
function is4120(e: unknown): boolean {
  const d = (e as AppError)?.details as { code?: number } | undefined;
  if (d && typeof d === 'object' && d.code === -4120) return true;
  return /-4120/.test(String((e as Error)?.message ?? e));
}

/**
 * Per-tenant Binance USDT-M Futures client.
 *
 * Crucially this is INSTANTIATED PER USER with that user's decrypted keys — it
 * never reads a global key. The original single-user bot signed every request
 * with one process-wide key; here each call is bound to one tenant's creds, so
 * a user's bot can only ever touch that user's Binance account.
 *
 * Public market data (klines, funding) is fetched unsigned from the spot host,
 * which is geo-blocked (HTTP 451) less often than the futures data host — the
 * same lesson learned in the original project.
 */

// ── Module-level rate-limit circuit breaker (shared across tenants) ─────────
// A -1003 ban is per-IP, so it affects every tenant on this worker. We persist
// the ban expiry in memory and refuse ALL calls until it clears — blocked-but-
// attempted calls would otherwise EXTEND the ban.
let banUntilMs = 0;
export function isBanned(): boolean { return Date.now() < banUntilMs; }
function recordBanFromMsg(msg: string): void {
  const m = msg.match(/banned until (\d+)/i);
  if (m) banUntilMs = Number(m[1]);
  else banUntilMs = Date.now() + 60_000; // conservative default
  logger.error({ banUntilMs }, 'Binance IP ban recorded — standing down');
}

// Tiny TTL cache for public data to stay under weight limits.
const cache = new Map<string, { at: number; ttl: number; val: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.val as T;
  const val = await fn();
  cache.set(key, { at: Date.now(), ttl: ttlMs, val });
  return val;
}

export interface BinanceCreds { apiKey: string; secret: string }

export interface Candle { openTime: number; open: number; high: number; low: number; close: number; volume: number }

export class BinanceClient {
  constructor(private readonly creds: BinanceCreds) {}

  // ── signed futures call ───────────────────────────────────────────────
  private async signed<T>(method: 'GET' | 'POST' | 'DELETE', path: string,
    params: Record<string, string | number> = {}): Promise<T> {
    if (isBanned()) throw Errors.tooMany('Binance rate-limit ban active');
    const ts = Date.now();
    const qs = new URLSearchParams({ ...mapToStr(params), timestamp: String(ts), recvWindow: '5000' });
    const sig = hmacSha256(this.creds.secret, qs.toString());
    qs.append('signature', sig);
    const url = `${env.BINANCE_FAPI_BASE}${path}?${qs.toString()}`;
    const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': this.creds.apiKey } });
    const text = await res.text();
    if (!res.ok) {
      if (text.includes('-1003') || /banned/i.test(text)) recordBanFromMsg(text);
      throw Errors.upstream(`Binance ${res.status}`, safeJson(text));
    }
    return safeJson(text) as T;
  }

  // ── account ────────────────────────────────────────────────────────────
  async getBalance(): Promise<{ totalUsdt: number; availableUsdt: number }> {
    const data = await this.signed<Array<{ asset: string; balance: string; availableBalance: string }>>(
      'GET', '/fapi/v2/balance');
    const usdt = data.find((b) => b.asset === 'USDT');
    return { totalUsdt: Number(usdt?.balance ?? 0), availableUsdt: Number(usdt?.availableBalance ?? 0) };
  }

  async getPositions(): Promise<Array<{ symbol: string; positionAmt: number; entryPrice: number; markPrice: number; unRealizedProfit: number; leverage: number }>> {
    const data = await this.signed<Array<Record<string, string>>>('GET', '/fapi/v2/positionRisk');
    return data
      .filter((p) => Number(p.positionAmt) !== 0)
      .map((p) => ({
        symbol: p.symbol!, positionAmt: Number(p.positionAmt),
        entryPrice: Number(p.entryPrice), markPrice: Number(p.markPrice),
        unRealizedProfit: Number(p.unRealizedProfit), leverage: Number(p.leverage),
      }));
  }

  /** Today's realized PnL fills (for daily-cap + fee accrual). */
  async getRealizedIncome(sinceMs: number) {
    return this.signed<Array<{ symbol: string; income: string; time: number; tranId: number; incomeType: string }>>(
      'GET', '/fapi/v1/income', { incomeType: 'REALIZED_PNL', startTime: sinceMs, limit: 1000 });
  }

  /** ALL futures income (realized PnL + COMMISSION + FUNDING_FEE + …) since a time.
   *  Weight 30 — cache the result. Powers the real-account P&L reconciliation panel. */
  async getAllIncome(sinceMs: number) {
    return this.signed<Array<{ symbol: string; income: string; time: number; incomeType: string }>>(
      'GET', '/fapi/v1/income', { startTime: sinceMs, limit: 1000 });
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    try { await this.signed('POST', '/fapi/v1/leverage', { symbol, leverage }); }
    catch (e) { logger.warn({ e, symbol }, 'setLeverage failed (continuing)'); }
  }

  /** Market order in coin units (qty). Caller computes qty from USD notional. */
  async marketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number, reduceOnly = false) {
    return this.signed('POST', '/fapi/v1/order', {
      symbol, side, type: 'MARKET', quantity, ...(reduceOnly ? { reduceOnly: 'true' } : {}),
    });
  }

  /**
   * Resting server-side STOP_MARKET that closes the position the instant MARK
   * price crosses `stopPrice` — protection that survives the 60s watchdog gap.
   * `side` is the CLOSING side: SELL for a long, BUY for a short. Tries
   * closePosition=true first; on the -4120 rejection retries with the documented
   * reduceOnly+quantity fallback (needs `quantity`).
   */
  async placeStopMarket(symbol: string, side: 'BUY' | 'SELL', stopPrice: number,
    opts: { quantity?: number } = {}) {
    const base = { symbol, side, type: 'STOP_MARKET', stopPrice, workingType: 'MARK_PRICE', priceProtect: 'true' };
    try {
      return await this.signed('POST', '/fapi/v1/order', { ...base, closePosition: 'true' });
    } catch (e) {
      if (is4120(e) && opts.quantity != null) {
        return this.signed('POST', '/fapi/v1/order', { ...base, quantity: opts.quantity, reduceOnly: 'true' });
      }
      throw e;
    }
  }

  /** Open orders for ONE symbol (weight 1 — never poll the no-symbol form, weight 40). */
  async getOpenOrders(symbol: string) {
    return this.signed<Array<{ orderId: number; type: string; side: string; stopPrice: string }>>(
      'GET', '/fapi/v1/openOrders', { symbol });
  }

  /** Cancel every resting order on a symbol (used before re-placing a moved stop,
   *  and to clean up after a close). Best-effort — a failure must not block the close. */
  async cancelAllOpenOrders(symbol: string): Promise<void> {
    try { await this.signed('DELETE', '/fapi/v1/allOpenOrders', { symbol }); }
    catch (e) { logger.warn({ e, symbol }, 'cancelAllOpenOrders failed (continuing)'); }
  }

  // ── validation (used by api-key onboarding) ─────────────────────────────
  async validate(): Promise<{ canTrade: boolean; canWithdraw: boolean }> {
    const acct = await this.signed<{ canTrade: boolean; canWithdraw?: boolean }>('GET', '/fapi/v2/account');
    return { canTrade: !!acct.canTrade, canWithdraw: !!acct.canWithdraw };
  }

  // ── public market data (no auth, spot host, cached) ─────────────────────
  static async klines(symbol: string, interval: string, limit = 100): Promise<Candle[]> {
    return cached(`kl:${symbol}:${interval}:${limit}`, 3_000, async () => {
      const url = `${env.BINANCE_SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw Errors.upstream(`klines ${res.status}`);
      const raw = (await res.json()) as unknown[][];
      return raw.map((k) => ({
        openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
        low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
      }));
    });
  }

  /** Batch last-price for live PnL ticking. Public spot host, cached ~1.5s so a
   *  per-second dashboard poll collapses to one upstream call. */
  static async tickerPrices(symbols: string[]): Promise<Record<string, number>> {
    if (!symbols.length) return {};
    const key = `tick:${[...symbols].sort().join(',')}`;
    return cached(key, 1_500, async () => {
      const param = encodeURIComponent(JSON.stringify(symbols));
      const url = `${env.BINANCE_SPOT_BASE}/api/v3/ticker/price?symbols=${param}`;
      const res = await fetch(url);
      if (!res.ok) throw Errors.upstream(`ticker ${res.status}`);
      const raw = (await res.json()) as Array<{ symbol: string; price: string }>;
      const out: Record<string, number> = {};
      for (const r of raw) out[r.symbol] = Number(r.price);
      return out;
    });
  }

  static async funding(symbol: string): Promise<number> {
    return cached(`fund:${symbol}`, 60_000, async () => {
      const url = `${env.BINANCE_FAPI_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`;
      const res = await fetch(url);
      if (!res.ok) return 0;
      const j = (await res.json()) as { lastFundingRate?: string };
      return Number(j.lastFundingRate ?? 0);
    });
  }

  /** Top USDT-M perpetuals by 24h quote volume (most liquid/traded). The full
   *  sorted list is cached 5m; callers slice to the N they need. */
  static async topSymbols(limit = 10): Promise<string[]> {
    const all = await cached('top:usdt-perps', 5 * 60_000, async () => {
      const res = await fetch(`${env.BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`);
      if (!res.ok) throw Errors.upstream(`24hr ticker ${res.status}`);
      const raw = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>;
      const futTop = raw
        .filter((t) => /^[A-Z0-9]+USDT$/.test(t.symbol)) // USDT perpetuals only (skip dated contracts)
        .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
        .map((t) => t.symbol);
      // Keep only symbols that ALSO trade on SPOT. The dashboard computes signals from
      // spot klines, so futures-only perps (e.g. 1000PEPEUSDT, 1000BONKUSDT) have no
      // spot data and silently drop — which is why "Top 10" was showing only ~6.
      // Filtering here (before slicing) means Top N returns a full N analysable coins.
      let spot: Set<string> | null = null;
      try {
        const s = await fetch(`${env.BINANCE_SPOT_BASE}/api/v3/exchangeInfo`);
        if (s.ok) {
          const j = (await s.json()) as { symbols?: Array<{ symbol: string; status: string }> };
          spot = new Set((j.symbols ?? []).filter((x) => x.status === 'TRADING').map((x) => x.symbol));
        }
      } catch { /* spot list unavailable → fall back to the unfiltered futures ranking */ }
      return spot ? futTop.filter((sym) => spot!.has(sym)) : futTop;
    });
    return all.slice(0, Math.max(1, Math.min(limit, all.length)));
  }

  /**
   * Per-symbol futures trading filters — LOT_SIZE stepSize/minQty + MIN_NOTIONAL —
   * parsed from exchangeInfo and cached 6h. Used to size orders at the EXACT
   * precision Binance requires (otherwise orders are rejected with -1111). The
   * source host is fapi, which is reachable exactly when live trading is, so this
   * is available whenever it's actually needed. Returns null if unavailable.
   */
  static async symbolFilters(symbol: string): Promise<SymbolFilters | null> {
    const map = await cached('fapi:exinfo', 6 * 3_600_000, async () => {
      const res = await fetch(`${env.BINANCE_FAPI_BASE}/fapi/v1/exchangeInfo`);
      if (!res.ok) throw Errors.upstream(`exchangeInfo ${res.status}`);
      const j = (await res.json()) as { symbols?: Array<{ symbol: string; pricePrecision?: number; quantityPrecision?: number; filters: Array<Record<string, string>> }> };
      const m = new Map<string, SymbolFilters>();
      for (const s of j.symbols ?? []) {
        const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE');
        const notl = s.filters.find((f) => f.filterType === 'MIN_NOTIONAL');
        const price = s.filters.find((f) => f.filterType === 'PRICE_FILTER');
        m.set(s.symbol, {
          stepSize: Number(lot?.stepSize ?? 0),
          minQty: Number(lot?.minQty ?? 0),
          minNotional: Number(notl?.notional ?? notl?.minNotional ?? 0),
          tickSize: Number(price?.tickSize ?? 0),
          pricePrecision: Number(s.pricePrecision ?? 2),
          qtyPrecision: Number(s.quantityPrecision ?? 3),
        });
      }
      return m;
    }).catch(() => null);
    return map ? map.get(symbol) ?? null : null;
  }
}

export interface SymbolFilters {
  stepSize: number; minQty: number; minNotional: number;
  tickSize: number; pricePrecision: number; qtyPrecision: number;
}

/** Floor a quantity to the symbol's LOT_SIZE step (e.g. step 1 → whole units,
 *  step 0.001 → 3dp). Binance rejects any quantity not on the step grid (-1111). */
export function floorToStep(qty: number, step: number): number {
  if (!step || step <= 0) return qty;
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.floor(qty / step) * step).toFixed(decimals));
}

/** Round a price to the symbol's PRICE_FILTER tickSize grid. Binance rejects any
 *  stopPrice not on the tick grid (-1111), so every trigger order goes through here. */
export function roundToTick(price: number, tick: number): number {
  if (!tick || tick <= 0) return price;
  const decimals = Math.max(0, Math.round(-Math.log10(tick)));
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

function mapToStr(o: Record<string, string | number>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
}
function safeJson(t: string): unknown { try { return JSON.parse(t); } catch { return t; } }
