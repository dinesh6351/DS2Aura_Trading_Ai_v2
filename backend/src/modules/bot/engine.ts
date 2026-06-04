import type { BotConfig } from '@prisma/client';
import { PROFIT_TAKE_CAP as TAKE_PROFIT_CAP, MIN_RISK_REWARD, tpLadder } from '@platform/shared';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/http.js';
import { BinanceClient, floorToStep, roundToTick, type Candle } from '../binance/binance.client.js';
import { getMarketStatus, type MarketStatus } from '../binance/market.service.js';
import { apiKeyService } from '../apikeys/apikeys.service.js';
import { billingService } from '../fees/billing.service.js';
import { realtime } from '../notifications/realtime.js';
import { sendUserTelegram } from '../notifications/telegram.service.js';
import { calcEMA, calcVWAP, calcRSI, computeBiasOnTf } from './indicators.js';
import { runSafetyCheck, type StrategyCtx } from './strategy.js';
import { buildCandleCtx } from './strategy-context.js';
import { effectiveThreshold, bustLearningCache } from './learning.service.js';

const TIMEFRAME = '1m';
const MULTI_TFS = ['5m', '15m', '1h'];

interface ProtectionDecision {
  close: boolean;                 // full close of the remaining position
  reason: 'TP' | 'SL' | 'TRAIL';
  newStopLoss: number | null;
  lockPct: number | null;
  // Scaled-TP tranche (opt-in): book `partialPct` of the ORIGINAL qty now, then
  // ride the runner. `markFilled: 'tp2'` means both tranches are now done.
  partialPct?: number;
  partialReason?: 'TP1' | 'TP2';
  markFilled?: 'tp1' | 'tp2';
}

/**
 * Pure protection evaluator shared by the live and paper watchdogs. Decides
 * whether to close, and whether the stop should ratchet up. With break-even or
 * trailing enabled it arms once profit ≥ cfg.trailArmPct%, then trails the stop
 * cfg.trailGapPct% behind the running profit (ratchets up only, floored at
 * break-even) under a +5% take-profit cap; otherwise a fixed SL / (slPct × tpRR) TP.
 */
function evaluateProtection(
  pos: { side: string; entryPrice: unknown; stopLoss: unknown; trailingArmed?: boolean;
         tp1Filled?: boolean; tp2Filled?: boolean },
  mark: number,
  cfg: BotConfig,
): ProtectionDecision {
  const entry = Number(pos.entryPrice);
  const long = pos.side === 'LONG';
  const pnlFrac = long ? (mark - entry) / entry : (entry - mark) / entry;
  const slPct = Number(cfg.slPercent) / 100;
  const tpPct = slPct * Number(cfg.tpRR);
  const protectionOn = cfg.useTrailingStop || cfg.useBreakEven;

  // ── Scaled take-profit ladder (opt-in). Evaluated FIRST so the runner only
  // closes the final tranche. Booking any tranche moves the stop to break-even,
  // so a winner can never turn into a loss. One tick can "catch up" through both
  // tranches if price jumped (TP2 reached with TP1 still unbooked → book both). ──
  const lad = cfg.useScaledTp ? tpLadder({
    slPercent: Number(cfg.slPercent), tpRR: Number(cfg.tpRR),
    tp1Pct: Number(cfg.tp1Pct), tp1SizePct: cfg.tp1SizePct,
    tp2Frac: Number(cfg.tp2Frac), tp2SizePct: cfg.tp2SizePct,
  }) : null;
  if (lad && !pos.tp2Filled) {
    const beStop = entry; // break-even
    if (pnlFrac >= lad.tp2) {
      const pct = (pos.tp1Filled ? lad.tp2SizePct : lad.tp1SizePct + lad.tp2SizePct) / 100;
      return { close: false, reason: 'TP', newStopLoss: beStop, lockPct: 0, partialPct: pct, partialReason: 'TP2', markFilled: 'tp2' };
    }
    if (!pos.tp1Filled && pnlFrac >= lad.tp1) {
      return { close: false, reason: 'TP', newStopLoss: beStop, lockPct: 0, partialPct: lad.tp1SizePct / 100, partialReason: 'TP1', markFilled: 'tp1' };
    }
  }

  // Take profit: with scaled TP the runner closes at the full RR target (lad.tp3);
  // otherwise the +5% cap when laddering, else the fixed R:R target.
  const tpLevel = lad ? lad.tp3 : (protectionOn ? TAKE_PROFIT_CAP : tpPct);
  if (pnlFrac >= tpLevel) return { close: true, reason: 'TP', newStopLoss: null, lockPct: null };

  // Ratchet the stop up from the user's trail config (favorable moves only): once
  // profit ≥ arm%, keep the stop gap% behind the running profit, floored at break-even.
  let newStopLoss: number | null = null;
  let lockPct: number | null = null;
  if (protectionOn) {
    const armPct = Number(cfg.trailArmPct) / 100;
    const gapPct = Number(cfg.trailGapPct) / 100;
    lockPct = pnlFrac >= armPct ? Math.max(0, pnlFrac - gapPct) : null;
    if (lockPct != null) {
      const candidate = long ? entry * (1 + lockPct) : entry * (1 - lockPct);
      const baseStop = long ? entry * (1 - slPct) : entry * (1 + slPct);
      const cur = pos.stopLoss != null ? Number(pos.stopLoss) : baseStop;
      if (long ? candidate > cur : candidate < cur) newStopLoss = candidate;
    }
  }

  // Close if mark has crossed the effective stop (trailed level or hard stop).
  const baseStop = long ? entry * (1 - slPct) : entry * (1 + slPct);
  const curStop = pos.stopLoss != null ? Number(pos.stopLoss) : baseStop;
  const effStop = newStopLoss ?? curStop;
  const hitStop = long ? mark <= effStop : mark >= effStop;
  if (hitStop) {
    const reason: 'TRAIL' | 'SL' = pos.trailingArmed ? 'TRAIL' : 'SL';
    return { close: true, reason, newStopLoss: null, lockPct };
  }
  return { close: false, reason: 'SL', newStopLoss, lockPct };
}

/**
 * Evaluate + (optionally) execute one tick for a SINGLE tenant.
 *
 * Every Binance interaction goes through a client bound to THIS user's keys, so
 * there is no way for one user's tick to read or mutate another's account.
 */
export async function tickUser(userId: string): Promise<void> {
  const cfg = await prisma.botConfig.findUnique({ where: { userId } });
  if (!cfg) return;
  // STOPPED / ERROR → fully idle. RUNNING and PAUSED both run the watchdog below so
  // open positions stay protected; PAUSED simply opens no NEW trades (gated after the
  // watchdog) — e.g. when the daily-trade-limit guard pauses the bot until you Start.
  if (cfg.status !== 'RUNNING' && cfg.status !== 'PAUSED') return;

  // A PAUSED bot only needs ticking while it still has open positions to protect;
  // once flat there's nothing to do until the user presses Start (avoids pointless
  // Binance calls for idle paused bots).
  if (cfg.status === 'PAUSED' && (await prisma.position.count({ where: { userId, status: 'OPEN' } })) === 0) return;

  let creds;
  try {
    creds = await apiKeyService.getDecryptedCreds(userId);
  } catch (e) {
    await pauseWithError(userId, 'No valid Binance API key');
    logger.warn({ userId, e }, 'tick aborted: no creds');
    return;
  }
  const client = new BinanceClient(creds);

  // 1. sync account + positions (also drives the watchdog). In PAPER mode we read
  // the real balance for display but never place/close real orders.
  const [balance, exchangePositions] = await Promise.all([client.getBalance(), client.getPositions()]);
  await prisma.tradingAccount.updateMany({
    where: { userId },
    data: { totalBalance: balance.totalUsdt, availableBalance: balance.availableUsdt, lastSyncedAt: new Date() },
  });
  if (cfg.paperTrading) await runPaperWatchdog(userId, cfg);
  else await runWatchdog(userId, client, cfg, exchangePositions);

  // Open positions are now protected. Everything below OPENS new trades, so it's
  // gated to RUNNING — a PAUSED bot manages existing positions but takes no new ones.
  if (cfg.status !== 'RUNNING') return;

  // 2. subscription gate — VIEW-ONLY when trial/subscription has lapsed.
  // The watchdog above STILL protects existing positions, but no new trades or
  // signals are produced (bot + AI signals disabled until the user renews).
  if (!(await billingService.canTradeNow(userId))) {
    realtime.publish(`user:${userId}:signals`, { decisions: [], viewOnly: true, at: Date.now() });
    return;
  }

  // 3. risk pre-checks
  if (cfg.consecutiveLosses >= cfg.maxConsecutiveLosses) {
    await pauseWithError(userId, `Auto-paused after ${cfg.consecutiveLosses} consecutive losses`);
    return;
  }
  // maxTradesPerDay = 0 means UNLIMITED (admin) — skip the daily cap entirely.
  if (cfg.maxTradesPerDay > 0 && cfg.tradesToday >= cfg.maxTradesPerDay) { await pauseForDailyCap(userId, cfg.maxTradesPerDay); return; }
  // Concurrency: in PAPER mode count our simulated DB positions; in LIVE mode
  // count what's actually on the exchange.
  const dbOpen = await prisma.position.findMany({ where: { userId, status: 'OPEN' }, select: { symbol: true } });
  const openCount = cfg.paperTrading ? dbOpen.length : exchangePositions.length;
  if (openCount >= cfg.maxConcurrentPositions) return;

  // 50% margin guard
  const usedMarginPct = balance.totalUsdt > 0
    ? ((balance.totalUsdt - balance.availableUsdt) / balance.totalUsdt) * 100 : 100;
  if (usedMarginPct >= cfg.marginGuardPct) return;

  // 3. scan watchlist
  const watchlist = await prisma.watchlist.findFirst({ where: { userId, isDefault: true } });
  const symbols = watchlist?.symbols ?? ['BTCUSDT'];
  const heldSymbols = new Set(
    cfg.paperTrading ? dbOpen.map((p) => p.symbol) : exchangePositions.map((p) => p.symbol),
  );
  const decisions: Array<{ symbol: string; bias: string; score: number; allPass: boolean }> = [];
  const market = await getMarketStatus(); // shared across all tenants, cached 60s

  let slotsLeft = cfg.maxConcurrentPositions - openCount;
  let dailyLeft = cfg.maxTradesPerDay > 0 ? cfg.maxTradesPerDay - cfg.tradesToday : Infinity; // remaining trades allowed TODAY (0 cap = unlimited); enforced per-trade so we never overshoot within one tick
  let availableLeft = balance.availableUsdt; // decremented as we allocate this tick
  const marginUsd = Number(cfg.marginPerTradeUsd);
  // Rank highest-confidence setups first so the best ones win the open slots.
  const ranked: Array<{ symbol: string; bias: 'long' | 'short'; entryPrice: number; score: number }> = [];
  for (const symbol of symbols) {
    if (heldSymbols.has(symbol)) continue; // never stack the same coin
    const decision = await evaluateSymbol(symbol, cfg, market);
    decisions.push({ symbol, bias: decision.bias, score: decision.score, allPass: decision.allPass });
    if (decision.allPass && decision.entryPrice) {
      ranked.push({ symbol, bias: decision.bias as 'long' | 'short', entryPrice: decision.entryPrice, score: decision.score });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  for (const r of ranked) {
    if (slotsLeft <= 0 || dailyLeft <= 0) break; // stop at the daily cap, never over it
    const opened = await openPosition(userId, client, cfg, r.symbol, r.bias, r.entryPrice, r.score, availableLeft);
    if (opened) { slotsLeft--; dailyLeft--; availableLeft -= marginUsd; }
  }

  await prisma.botConfig.update({ where: { userId }, data: { lastTickAt: new Date() } });
  realtime.publish(`user:${userId}:signals`, { decisions, at: Date.now() });
  // Reached the daily limit this tick → pause; the bot won't trade again until Start.
  if (dailyLeft <= 0) await pauseForDailyCap(userId, cfg.maxTradesPerDay);
}

/** Build the full strategy context for one symbol and score it. */
async function evaluateSymbol(symbol: string, cfg: BotConfig, market: MarketStatus) {
  const candles = await BinanceClient.klines(symbol, TIMEFRAME, 250);
  if (candles.length < 60) return { bias: 'none', score: 0, allPass: false, entryPrice: 0 };
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const ema8 = calcEMA(closes, 8);
  const vwap = calcVWAP(candles);
  const rsi3 = calcRSI(closes, 3);

  // multi-TF agreement
  const tfBiases = await Promise.all(MULTI_TFS.map(async (tf) => {
    const c = await BinanceClient.klines(symbol, tf, 100);
    return computeBiasOnTf(c);
  }));
  const baseDir = price > vwap && price > ema8 ? 'long' : price < vwap && price < ema8 ? 'short' : 'none';
  const agree = tfBiases.filter((b) => b === baseDir).length;

  const funding = await BinanceClient.funding(symbol).catch(() => 0);

  const ctx: StrategyCtx = {
    ...buildCandleCtx(candles), // full professional indicator suite (~50 conditions)
    funding,
    multiTfAgree: { dir: baseDir as 'long' | 'short' | 'none', passed: agree, total: MULTI_TFS.length },
    // shared market context → drives the critical gates
    btcTrend: symbol === 'BTCUSDT' ? undefined : market.btcTrend,
    marketVerdict: market.verdict,
    fearGreed: { value: market.fearGreed.value },
    toggles: {
      adx: cfg.useAdxFilter, ema: cfg.useEmaTrend, rsi: cfg.useRsi,
      volume: cfg.useVolume, atr: cfg.useAtr,
    },
  };

  // Adaptive learning (opt-in): tune the quality bar for THIS coin from the
  // user's own closed-trade record. A blocked coin gets a 101 bar it can't clear.
  const threshold = cfg.useAdaptiveLearning
    ? await effectiveThreshold(cfg.userId, cfg.scoreThreshold, symbol)
    : cfg.scoreThreshold;
  const result = runSafetyCheck(price, ema8, vwap, rsi3, ctx, threshold);
  return { ...result, entryPrice: price };
}

/** Size in USD → coin qty, set leverage, place market order, persist position. */
async function openPosition(
  userId: string, client: BinanceClient, cfg: BotConfig,
  symbol: string, bias: 'long' | 'short', entryPrice: number, score: number,
  availableUsdt: number,
): Promise<boolean> {
  const marginUsd = Number(cfg.marginPerTradeUsd);

  // Section 5 — R:R floor. With the profit ladder the trade rides to +5% against
  // a ~1% risk (≈1:5); without it we use the configured tpRR. Reject < 1:3.
  const effRR = (cfg.useTrailingStop || cfg.useBreakEven)
    ? TAKE_PROFIT_CAP / (Number(cfg.slPercent) / 100)
    : Number(cfg.tpRR);
  if (effRR < MIN_RISK_REWARD) {
    await notify(userId, 'Signal rejected', `${symbol}: R:R 1:${effRR.toFixed(1)} is below the 1:${MIN_RISK_REWARD} minimum.`);
    return false;
  }

  // Section 4 — pre-flight wallet balance (5% buffer for fees/slippage).
  if (availableUsdt < marginUsd * 1.05) {
    await notify(userId, '⚠ Insufficient balance',
      `Trade conditions satisfied for ${symbol}, but insufficient wallet balance available for execution (need ~$${(marginUsd * 1.05).toFixed(2)}, have $${availableUsdt.toFixed(2)}).`);
    return false;
  }

  const notional = marginUsd * cfg.leverage;
  if (notional < 5) return false; // global Binance min-notional safety

  // Per-symbol precision: floor to the symbol's LOT_SIZE step and honour minQty /
  // minNotional, so live orders aren't rejected (-1111) or sized wrong. Falls back
  // to the crude 3-dp rounding only when exchangeInfo isn't reachable (paper/dev).
  const filters = await BinanceClient.symbolFilters(symbol).catch(() => null);
  const qty = filters ? floorToStep(notional / entryPrice, filters.stepSize) : roundQty(notional / entryPrice);
  if (qty <= 0) return false;
  if (filters) {
    if (filters.minQty && qty < filters.minQty) {
      await notify(userId, 'Signal skipped', `${symbol}: size ${qty} is below the exchange minimum (${filters.minQty}). Increase margin or leverage for this coin.`);
      return false;
    }
    const minNotional = filters.minNotional || 5;
    if (qty * entryPrice < minNotional) {
      await notify(userId, 'Signal skipped', `${symbol}: order value $${(qty * entryPrice).toFixed(2)} is below the exchange minimum $${minNotional}. Increase margin or leverage.`);
      return false;
    }
  }

  const slPercent = Number(cfg.slPercent) / 100;
  const stopLoss = bias === 'long' ? entryPrice * (1 - slPercent) : entryPrice * (1 + slPercent);
  const tpPercent = slPercent * Number(cfg.tpRR);
  const takeProfit = bias === 'long' ? entryPrice * (1 + tpPercent) : entryPrice * (1 - tpPercent);
  const closeSide = bias === 'long' ? 'SELL' : 'BUY';

  try {
    let orderId: number | undefined;
    if (cfg.paperTrading) {
      orderId = undefined; // simulated — no real order
    } else {
      await client.setLeverage(symbol, cfg.leverage);
      const side = bias === 'long' ? 'BUY' : 'SELL';
      const order = await client.marketOrder(symbol, side, qty) as { orderId?: number };
      orderId = order.orderId;

      // Prefer a server-side STOP_MARKET so the position is protected the instant
      // price crosses it (no 60s gap). If it can't attach — e.g. the key lacks
      // "Futures Algo Orders" (-4120) — DON'T abort: the software watchdog still
      // enforces the stop / trailing / TP every tick, which is the original design.
      // Warn once so the user can enable Algo Orders for instant server-side stops.
      const stopPx = filters ? roundToTick(stopLoss, filters.tickSize) : stopLoss;
      try {
        await client.placeStopMarket(symbol, closeSide, stopPx, { quantity: qty });
      } catch (e) {
        logger.warn({ userId, symbol, e }, 'exchange SL attach failed — falling back to software watchdog');
        await notify(userId, '⚠ Using software stop-loss',
          `${symbol}: opened, but the exchange-side stop couldn’t be attached, so the bot is protecting it with its 60-second software watchdog instead. For instant server-side stops, enable “Futures Algo Orders” on your Binance API key (Binance → API Management → Edit restrictions).`);
      }
    }

    await prisma.position.create({
      data: {
        userId, symbol, side: bias === 'long' ? 'LONG' : 'SHORT', status: 'OPEN',
        entryPrice, markPrice: entryPrice, quantity: qty, originalQuantity: qty, leverage: cfg.leverage,
        marginUsd, stopLoss, takeProfit, entryScore: score, entryBias: bias,
        binanceOrderId: orderId ? String(orderId) : null,
      },
    });
    await prisma.botConfig.update({ where: { userId }, data: { tradesToday: { increment: 1 } } });
    await billingService.recordTradeOpened(userId); // monthly usage meter (150 incl. + $0.10 overage)
    realtime.publish(`user:${userId}:positions`, { event: 'OPEN', symbol, side: bias, entryPrice });
    const tag = cfg.paperTrading ? ' [PAPER]' : '';
    await notify(userId, `Position opened${tag}`, `${bias.toUpperCase()} ${symbol} @ ${entryPrice} (score ${score})`);
    return true;
  } catch (e) {
    logger.error({ userId, symbol, e }, 'openPosition failed');
    return false;
  }
}

/**
 * Live protection — hybrid of exchange-side and software stops:
 *  - Primary: a server-side STOP_MARKET (placed on entry, ratcheted up here as the
 *    profit ladder arms) closes the position the instant price crosses it, even
 *    between 60s ticks. This is what closes the fast-reversal gap.
 *  - Backup: this software watchdog still evaluates each tick and market-closes
 *    with reduceOnly, in case the exchange stop was rejected (-4120 with no Algo
 *    permission) or hasn't filled yet. It also self-heals any position whose
 *    server-side stop went missing (orphan protection) and reconciles positions
 *    that left the exchange using Binance's own realized PnL.
 */
async function runWatchdog(
  userId: string, client: BinanceClient, cfg: BotConfig,
  positions: Awaited<ReturnType<BinanceClient['getPositions']>>,
): Promise<void> {
  const open = await prisma.position.findMany({ where: { userId, status: 'OPEN' } });
  const live = new Map(positions.map((p) => [p.symbol, p]));

  for (const pos of open) {
    const long = pos.side === 'LONG';
    const closeSide = long ? 'SELL' : 'BUY';
    const ex = live.get(pos.symbol);

    // Gone from the exchange → the server-side stop fired between ticks, or it was
    // closed manually / liquidated. Reconstruct the true exit from Binance's own
    // realized PnL so the recorded trade matches the wallet, then reconcile.
    if (!ex) {
      let exitPx = Number(pos.markPrice ?? pos.entryPrice);
      let reason = 'EXTERNAL';
      try {
        const income = await client.getRealizedIncome(pos.openedAt.getTime());
        const realized = income.filter((i) => i.symbol === pos.symbol)
          .reduce((s, i) => s + Number(i.income), 0);
        if (realized !== 0) {
          const q = Number(pos.quantity);
          exitPx = long ? Number(pos.entryPrice) + realized / q : Number(pos.entryPrice) - realized / q;
          reason = pos.trailingArmed ? 'TRAIL' : realized < 0 ? 'SL' : 'TP';
        }
      } catch (e) { logger.warn({ e, pos: pos.id }, 'reconcile income lookup failed'); }
      await client.cancelAllOpenOrders(pos.symbol); // clear any leftover resting order
      await closePosition(userId, cfg, pos, exitPx, reason);
      continue;
    }

    const mark = ex.markPrice;
    const filters = await BinanceClient.symbolFilters(pos.symbol).catch(() => null);
    const prot = evaluateProtection(pos, mark, cfg);

    // Scaled-TP tranche: book a partial reduceOnly close + ratchet stop to break-even.
    if (prot.partialPct && prot.markFilled) {
      await executePartial(userId, client, cfg, pos, prot, mark, filters, closeSide, long);
      continue;
    }

    if (prot.close) {
      // Software backup — only reached if the server-side stop hasn't filled yet.
      try {
        await client.marketOrder(pos.symbol, closeSide, Number(pos.quantity), true);
      } catch (e) { logger.error({ e, pos: pos.id }, 'watchdog close failed'); continue; }
      await client.cancelAllOpenOrders(pos.symbol);
      await closePosition(userId, cfg, pos, mark, prot.reason);
      continue;
    }

    if (prot.newStopLoss != null) {
      await prisma.position.update({
        where: { id: pos.id },
        data: { stopLoss: prot.newStopLoss, markPrice: mark, unrealizedPnl: ex.unRealizedProfit,
                breakEvenArmed: true, trailingArmed: true },
      });
      // Ratchet the REAL stop up on the exchange (cancel + re-place at the new
      // level) so the locked-in profit is guarded server-side between ticks.
      const stopPx = filters ? roundToTick(prot.newStopLoss, filters.tickSize) : prot.newStopLoss;
      await client.cancelAllOpenOrders(pos.symbol);
      await client.placeStopMarket(pos.symbol, closeSide, stopPx, { quantity: Number(pos.quantity) })
        .catch((e) => logger.error({ e, pos: pos.id }, 'move stop failed — software watchdog still guards'));
      await notify(userId, '🔒 Profit lock updated',
        `${pos.symbol} stop → ${prot.newStopLoss.toFixed(6)} (securing +${((prot.lockPct ?? 0) * 100).toFixed(1)}%)`);
      continue;
    }

    // No change — refresh mark, then self-heal a missing stop (orphan protection).
    await prisma.position.update({ where: { id: pos.id }, data: { markPrice: mark, unrealizedPnl: ex.unRealizedProfit } });
    try {
      const orders = await client.getOpenOrders(pos.symbol);
      if (!orders.some((o) => o.type === 'STOP_MARKET')) {
        const curStop = pos.stopLoss != null ? Number(pos.stopLoss)
          : long ? Number(pos.entryPrice) * (1 - Number(cfg.slPercent) / 100)
                 : Number(pos.entryPrice) * (1 + Number(cfg.slPercent) / 100);
        const stopPx = filters ? roundToTick(curStop, filters.tickSize) : curStop;
        await client.placeStopMarket(pos.symbol, closeSide, stopPx, { quantity: Number(pos.quantity) });
        logger.info({ pos: pos.id }, 'orphan position re-protected with STOP_MARKET');
      }
    } catch (e) { logger.warn({ e, pos: pos.id }, 'orphan stop check failed'); }
  }
}

/**
 * PAPER watchdog: same break-even / trailing / SL-TP logic as the live one, but
 * mark price comes from public market data (no exchange position to read) and we
 * never place a real reduceOnly close — the position is simulated end-to-end.
 */
async function runPaperWatchdog(userId: string, cfg: BotConfig): Promise<void> {
  const open = await prisma.position.findMany({ where: { userId, status: 'OPEN' } });
  for (const pos of open) {
    const candles = await BinanceClient.klines(pos.symbol, '1m', 2).catch(() => [] as Candle[]);
    const mark = candles[candles.length - 1]?.close ?? Number(pos.markPrice ?? pos.entryPrice);
    const prot = evaluateProtection(pos, mark, cfg);
    if (prot.partialPct && prot.markFilled) {
      const filters = await BinanceClient.symbolFilters(pos.symbol).catch(() => null);
      const long = pos.side === 'LONG';
      const closeSide = long ? 'SELL' : 'BUY';
      await executePartial(userId, null, cfg, pos, prot, mark, filters, closeSide, long);
      continue;
    }
    if (prot.close) {
      await closePosition(userId, cfg, pos, mark, prot.reason);
    } else if (prot.newStopLoss != null) {
      await prisma.position.update({
        where: { id: pos.id },
        data: { stopLoss: prot.newStopLoss, markPrice: mark, breakEvenArmed: true, trailingArmed: true },
      });
      await notify(userId, '🔒 Profit lock updated [PAPER]',
        `${pos.symbol} stop → ${prot.newStopLoss.toFixed(6)} (securing +${((prot.lockPct ?? 0) * 100).toFixed(1)}%)`);
    } else {
      await prisma.position.update({ where: { id: pos.id }, data: { markPrice: mark } });
    }
  }
}

/**
 * Book ONE scaled-TP tranche: record a partial round-trip to the ledger and bank
 * the realized P&L, WITHOUT closing the position (the caller decrements quantity).
 * A booked tranche is always a profit, so it resets the consecutive-loss streak.
 */
async function bookPartialClose(
  userId: string, cfg: BotConfig,
  pos: { id: string; symbol: string; side: string; entryPrice: unknown; leverage: number; openedAt: Date },
  qty: number, exitPrice: number, reason: 'TP1' | 'TP2',
): Promise<void> {
  const entry = Number(pos.entryPrice);
  const long = pos.side === 'LONG';
  const grossPnl = (long ? exitPrice - entry : entry - exitPrice) * qty;
  const feeUsd = 0;           // recorded P&L mirrors the raw price move (see closePosition)
  const netPnl = grossPnl;
  await prisma.$transaction(async (tx) => {
    await tx.tradeHistory.create({
      data: {
        userId, symbol: pos.symbol, side: long ? 'LONG' : 'SHORT',
        entryPrice: entry, exitPrice, quantity: qty, leverage: pos.leverage,
        grossPnl, feeUsd, netPnl, exitReason: reason, positionId: pos.id,
        openedAt: pos.openedAt, durationSec: Math.round((Date.now() - pos.openedAt.getTime()) / 1000),
      },
    });
    if (netPnl > 0) await tx.botConfig.update({ where: { userId }, data: { consecutiveLosses: 0 } });
    await tx.wallet.update({ where: { userId }, data: { lifetimeProfit: { increment: netPnl } } });
  });
  bustLearningCache(userId);
  realtime.publish(`user:${userId}:positions`, { event: 'PARTIAL', symbol: pos.symbol, pnl: netPnl, reason });
  realtime.publish(`user:${userId}:pnl`, { realized: netPnl });
  const tag = cfg.paperTrading ? ' [PAPER]' : '';
  await notify(userId, `🎯 ${reason} booked${tag}`,
    `${pos.symbol}: booked ${reason} on ${qty} for ${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(4)} USDT — stop at break-even, runner riding.`);
}

/**
 * Execute a scaled-TP tranche end-to-end (live or paper): size it to the exchange
 * step / min-notional, place a reduceOnly partial close (live only), book it to the
 * ledger, decrement the position, ratchet the stop to break-even (never against the
 * trade) and move the server-side STOP_MARKET onto the remainder. If the tranche or
 * the remainder is below the exchange minimum it degrades gracefully — the tranche
 * is marked filled and the stop ratcheted, so the position simply rides as a single
 * break-even-protected runner instead of looping on an unplaceable order.
 */
async function executePartial(
  userId: string, client: BinanceClient | null, cfg: BotConfig,
  pos: { id: string; symbol: string; side: string; entryPrice: unknown; quantity: unknown;
         originalQuantity: unknown; stopLoss: unknown; leverage: number; openedAt: Date },
  prot: ProtectionDecision, mark: number,
  filters: { stepSize: number; tickSize: number; minQty: number; minNotional: number } | null,
  closeSide: 'BUY' | 'SELL', long: boolean,
): Promise<void> {
  const originalQty = Number(pos.originalQuantity ?? pos.quantity);
  const remaining = Number(pos.quantity);
  const minQty = filters?.minQty ?? 0;
  const minNotional = filters?.minNotional || 5;
  const tpFlags = prot.markFilled === 'tp2' ? { tp1Filled: true, tp2Filled: true } : { tp1Filled: true };

  // Break-even stop, ratcheted only in the favorable direction (never widened).
  const baseStop = long ? Number(pos.entryPrice) * (1 - Number(cfg.slPercent) / 100)
                        : Number(pos.entryPrice) * (1 + Number(cfg.slPercent) / 100);
  const curStop = pos.stopLoss != null ? Number(pos.stopLoss) : baseStop;
  const beTarget = prot.newStopLoss ?? curStop;
  const newStop = (long ? beTarget > curStop : beTarget < curStop) ? beTarget : curStop;

  const moveServerStop = async (qty: number) => {
    if (!client) return;
    const stopPx = filters ? roundToTick(newStop, filters.tickSize) : newStop;
    await client.cancelAllOpenOrders(pos.symbol).catch(() => {});
    await client.placeStopMarket(pos.symbol, closeSide, stopPx, { quantity: qty })
      .catch((e) => logger.error({ e, pos: pos.id }, 'scaled-TP: move stop failed — software watchdog still guards'));
  };

  let qtyToClose = filters ? floorToStep(originalQty * (prot.partialPct ?? 0), filters.stepSize)
                           : roundQty(originalQty * (prot.partialPct ?? 0));
  qtyToClose = Math.min(qtyToClose, remaining);

  // Tranche too small to place on its own → don't loop: mark filled + ratchet stop.
  if (qtyToClose <= 0 || qtyToClose < minQty || qtyToClose * mark < minNotional) {
    await prisma.position.update({
      where: { id: pos.id },
      data: { ...tpFlags, breakEvenArmed: true, trailingArmed: true, stopLoss: newStop, markPrice: mark },
    });
    await moveServerStop(remaining);
    return;
  }

  if (client) {
    try { await client.marketOrder(pos.symbol, closeSide, qtyToClose, true); }
    catch (e) { logger.error({ e, pos: pos.id }, 'scaled-TP: partial close order failed'); return; }
  }
  await bookPartialClose(userId, cfg, pos, qtyToClose, mark, prot.partialReason ?? 'TP1');

  const newRemaining = remaining - qtyToClose;
  // Dust remainder → finalize the position (it's effectively fully exited).
  if (newRemaining <= 0 || newRemaining < minQty || newRemaining * mark < minNotional) {
    if (client) await client.cancelAllOpenOrders(pos.symbol).catch(() => {});
    await prisma.position.update({
      where: { id: pos.id },
      data: { ...tpFlags, quantity: 0, status: 'CLOSED', exitPrice: mark, closedAt: new Date(), markPrice: mark },
    });
    return;
  }
  await prisma.position.update({
    where: { id: pos.id },
    data: { quantity: newRemaining, ...tpFlags, breakEvenArmed: true, trailingArmed: true, stopLoss: newStop, markPrice: mark },
  });
  await moveServerStop(newRemaining);
}

/** Finalize a position: write trade history, accrue platform fee, update streaks. */
async function closePosition(
  userId: string, cfg: BotConfig,
  pos: { id: string; symbol: string; side: string; entryPrice: unknown; quantity: unknown;
         leverage: number; marginUsd: unknown; openedAt: Date; entryScore: number | null },
  exitPrice: number, reason: string,
): Promise<void> {
  const entry = Number(pos.entryPrice);
  const qty = Number(pos.quantity);
  const long = pos.side === 'LONG';
  const grossPnl = (long ? exitPrice - entry : entry - exitPrice) * qty;
  // Binance fee is NOT deducted from the recorded P&L (user preference) — the bot's
  // P&L reflects the raw price move. The true after-fee wallet is shown separately
  // in the "Real Binance P&L" dashboard card (sourced from Binance's income feed).
  const feeUsd = 0;
  const netPnl = grossPnl;

  const trade = await prisma.$transaction(async (tx) => {
    await tx.position.update({
      where: { id: pos.id },
      data: { status: 'CLOSED', exitPrice, realizedPnl: netPnl, closedAt: new Date() },
    });
    const t = await tx.tradeHistory.create({
      data: {
        userId, symbol: pos.symbol, side: long ? 'LONG' : 'SHORT',
        entryPrice: entry, exitPrice, quantity: qty, leverage: pos.leverage,
        grossPnl, feeUsd, netPnl, // take-home = price P&L − exchange fees (no platform cut)
        exitReason: reason, openedAt: pos.openedAt,
        durationSec: Math.round((Date.now() - pos.openedAt.getTime()) / 1000),
      },
    });
    // Win/loss is decided on NET P&L — a trade that's gross-positive but eaten by
    // fees is a real loss and must count toward the consecutive-loss protector.
    const win = netPnl > 0;
    await tx.botConfig.update({
      where: { userId },
      data: win ? { consecutiveLosses: 0 } : { consecutiveLosses: { increment: 1 } },
    });
    // Track the user's lifetime trading P&L (their money — platform takes no cut).
    await tx.wallet.update({ where: { userId }, data: { lifetimeProfit: { increment: netPnl } } });
    return t;
  });
  void trade; void cfg;

  // Let adaptive learning see this outcome on the next tick (no-op if disabled).
  bustLearningCache(userId);

  realtime.publish(`user:${userId}:positions`, { event: 'CLOSE', symbol: pos.symbol, pnl: netPnl, reason });
  realtime.publish(`user:${userId}:pnl`, { realized: netPnl });
  const tag = cfg.paperTrading ? ' [PAPER]' : '';
  const title = reason === 'TP' ? '🎯 Take profit hit'
    : reason === 'TRAIL' ? (netPnl >= 0
        ? '📈 Trailing stop — profit secured'
        // The locked stop was hit, but a fast move between 60s ticks filled the
        // close below it — be honest that this one closed red.
        : '📉 Trailing stop — fast reversal, closed below the locked level')
    : reason === 'SL' ? '🛑 Stop loss hit'
    : reason === 'EXTERNAL' ? 'Position closed (external)'
    : netPnl >= 0 ? 'Trade won' : 'Trade lost';
  await notify(userId, `${title}${tag}`,
    `${pos.symbol} closed (${reason}): ${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(4)} USDT (after ${feeUsd.toFixed(4)} fee)`);
}

/** Daily trade cap reached → PAUSE the bot (no new trades) but keep protecting open
 *  positions. It won't auto-resume — the user presses Start to trade again. */
async function pauseForDailyCap(userId: string, cap: number) {
  await prisma.botConfig.update({
    where: { userId },
    data: { status: 'PAUSED', pausedReason: `Daily trade limit (${cap}) reached — press Start to trade again.` },
  });
  await notify(userId, '⏸ Daily trade limit reached',
    `The bot opened its ${cap} trade${cap === 1 ? '' : 's'} for today and has paused — it won't open more until you press Start (raise the limit first if you want more). Open positions stay protected.`);
}

async function pauseWithError(userId: string, reason: string) {
  await prisma.botConfig.update({ where: { userId }, data: { status: 'ERROR', pausedReason: reason } });
  await notify(userId, 'Bot paused', reason);
}

async function notify(userId: string, title: string, body: string) {
  await prisma.notification.create({ data: { userId, title, body } }).catch(() => {});
  realtime.publish(`user:${userId}:botlog`, { title, body, at: Date.now() });
  // Fire-and-forget Telegram to the user's OWN bot (no-op if not configured).
  void sendUserTelegram(userId, `<b>${title}</b>\n${body}`);
}

// crude qty rounding; replace with per-symbol stepSize from exchangeInfo in prod
function roundQty(q: number): number { return Math.floor(q * 1e3) / 1e3; }

/**
 * Manually close an OPEN position (user-initiated from the dashboard). LIVE: places
 * a reduceOnly market close on Binance + cancels resting orders; PAPER: closes the
 * simulated position. Records it to trade history with reason MANUAL.
 */
export async function manualClosePosition(userId: string, idOrSymbol: string): Promise<{ pnl: number; symbol: string }> {
  const cfg = await prisma.botConfig.findUnique({ where: { userId } });
  if (!cfg) throw Errors.notFound('No bot config');
  let pos = await prisma.position.findFirst({ where: { id: idOrSymbol, userId, status: 'OPEN' } })
    .catch(() => null); // idOrSymbol may be a symbol (not a uuid) → invalid-uuid query throws
  if (!pos) pos = await prisma.position.findFirst({ where: { userId, symbol: idOrSymbol, status: 'OPEN' } });
  if (!pos) throw Errors.notFound('Open position not found');

  const long = pos.side === 'LONG';
  let mark = Number(pos.markPrice ?? pos.entryPrice);
  try { const px = await BinanceClient.tickerPrices([pos.symbol]); const m = px[pos.symbol]; if (m) mark = m; } catch { /* keep last */ }

  if (!cfg.paperTrading) {
    let client: BinanceClient;
    try { client = new BinanceClient(await apiKeyService.getDecryptedCreds(userId)); }
    catch { throw Errors.badRequest('No valid Binance API key on file'); }
    try {
      await client.marketOrder(pos.symbol, long ? 'SELL' : 'BUY', Number(pos.quantity), true);
    } catch (e) { logger.error({ e, pos: pos.id }, 'manual close failed'); throw Errors.upstream('Could not close the position on Binance'); }
    await client.cancelAllOpenOrders(pos.symbol);
  }
  await closePosition(userId, cfg, pos, mark, 'MANUAL');
  const grossPnl = (long ? mark - Number(pos.entryPrice) : Number(pos.entryPrice) - mark) * Number(pos.quantity);
  return { pnl: grossPnl, symbol: pos.symbol };
}
