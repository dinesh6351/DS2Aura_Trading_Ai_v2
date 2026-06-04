'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api, openRealtime, getApiBase } from '@/lib/api';
import { CHANNELS, BILLING, centsToUsd, PROFIT_TAKE_CAP, TAKER_FEE_RATE, regionLabel } from '@platform/shared';
import { AppNav } from '@/components/AppNav';
import { useTheme, themeColors } from '@/lib/theme';

/** recharts tooltip styling that follows the active theme. */
const tip = (c: ReturnType<typeof themeColors>) => ({ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12, color: c.fg });

interface Account { totalBalance: number; availableBalance: number; marginUsed: number; unrealizedPnl: number; openPositions: number; lastSyncedAt: string | null; live?: boolean; }
interface Stats { winRate: number; realizedPnl: number; todayProfit: number; weeklyProfit: number; monthlyProfit: number; roi: number; totalTrades: number; timezone?: string; lastResetAt?: string | null; }
interface BotCfg {
  status: string; mode: string; scoreThreshold: number; leverage: number;
  marginPerTradeUsd: string; slPercent: string; tpRR: string; trailArmPct?: string; trailGapPct?: string;
  maxConcurrentPositions: number; maxTradesPerDay: number; lossCooldownMin: number; maxConsecutiveLosses?: number;
  dynamicSizing?: boolean; marginGuardPct?: number; consecutiveLosses?: number;
  useAdxFilter: boolean; useEmaTrend: boolean; useRsi: boolean; useVolume: boolean;
  useAtr: boolean; useBreakEven: boolean; useTrailingStop: boolean; pausedReason: string | null;
  useAdaptiveLearning?: boolean; paperTrading?: boolean;
}
interface Position { id: string; symbol: string; side: string; entryPrice: string; markPrice: string; quantity: string; leverage: number; stopLoss: string | null; takeProfit: string | null; unrealizedPnl: string; entryScore: number | null; }
interface SignalRow {
  symbol: string; bias: 'long' | 'short' | 'none'; score: number; threshold: number; allPass: boolean;
  ema8: number | null; rsi3: number | null; rsi14: number | null; volRatio: number | null;
  vwapDeltaPct: number | null; atrPct: number | null; adx: number | null; macdHist: number | null;
  trend: 'up' | 'down' | 'mixed' | 'n/a'; blocking: string;
  criticalFails?: string[]; weakConditions?: { label: string; weight: number }[];
  earnedWeight?: number; totalWeight?: number;
}
interface Usage {
  plan: string; status: string; tradesUsed: number; includedTrades: number;
  remainingIncludedTrades: number; overageTrades: number; estimatedInvoiceUsd: number;
  monthlyPriceUsd: number; overagePerTradeUsd: number; nextBillingDate: string | null;
  trialEndsAt: string | null; inTrial: boolean; canTrade: boolean; viewOnly: boolean;
  unlimited?: boolean; unlimitedTrades?: boolean; billingInterval?: string; planPriceUsd?: number; renewalDate?: string | null;
}
interface Market { btcTrend: string; verdict: string; fearGreed: { value: number; label: string }; fearGreedCmc?: { value: number; label: string } | null; btcAtrPct: number; btcPrice?: number; }
interface Trade {
  id: string; symbol: string; side: string; entryPrice: string; exitPrice: string; quantity: string;
  leverage: number; grossPnl: string; feeUsd: string; netPnl: string; rr: string | null;
  exitReason: string | null; openedAt: string; closedAt: string; durationSec: number | null;
  realFee?: number; funding?: number; // actual Binance commission + funding (matched from income)
}
interface Perf { symbol: string; trades: number; wins: number; winRate: number; netPnl: number; volume: number; riskScore: number; }
interface LogItem { id: string; title: string; body: string; createdAt: string; }
interface Intel {
  strategy: {
    regime: string; regimeLabel: string; confidence: number;
    metrics: { adx: number; atrPct: number; emaTrend: string; fearGreed: number };
    primary: { id: string; name: string; category: string; note: string };
    active: { id: string; name: string; category: string; implemented: boolean }[];
    avoid: string[]; reason: string;
    library: { total: number; implemented: number; byCategory: Record<string, number> };
  };
  fearGreed: { value: number; label: string; cmc?: { value: number; label: string } | null; history: { value: number; label: string; date: string }[]; recommendation: string };
  learning: {
    totalTrades: number; winRate: number; profitFactor: number;
    byReason: Record<string, { count: number; pnl: number }>;
    best: Perf[]; worst: Perf[];
    recent: { id: string; symbol: string; side: string; reason: string | null; netPnl: number; rr: number | null; win: boolean; worked: string; failed: string; suggestion: string; closedAt: string }[];
    lessons: string[]; topWinning: string[]; topLosing: string[];
  };
  marketIntel: { sentiment: string; btcTrend: string; verdict: string; fundingPct: number; whaleProxy: string; headlines: string[]; note: string };
}
interface Trip { id: string; side: string; entry: number; exit: number; netPnl: number; grossPnl: number; rr: number | null; durationSec: number | null; exitReason: string | null; openedAt: string; closedAt: string; analysis: string; }
interface LearningCoin { symbol: string; trades: number; winRate: number; netPnl: number; blocked: boolean; threshold: number | null; delta: number | null; note: string; }
interface LearningOverview {
  enabled: boolean; baseThreshold: number; coinsLearned: number;
  raised: number; lowered: number; blocked: number; minSamples: number; coins: LearningCoin[];
}

interface PnlBucket { net: number; realizedPnl: number; fees: number; funding: number; trades: number; }
interface BinancePnl { live: boolean; paper?: boolean; today?: PnlBucket; week?: PnlBucket; }

const num = (v: unknown) => Number(v ?? 0);
const DAY = 864e5;

export default function Dashboard() {
  const [account, setAccount] = useState<Account>();
  const [stats, setStats] = useState<Stats>();
  const [bot, setBot] = useState<BotCfg>();
  const [positions, setPositions] = useState<Position[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [usage, setUsage] = useState<Usage>();
  const [market, setMarket] = useState<Market>();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [perf, setPerf] = useState<Perf[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [detail, setDetail] = useState<{ symbol: string; trips: Trip[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoad, setLastLoad] = useState(Date.now());
  const [intel, setIntel] = useState<Intel>();
  const [bpnl, setBpnl] = useState<BinancePnl>();

  const loadSignals = useCallback(async () => {
    // Keep the LAST good signals when a refresh fails or returns nothing — so the
    // Live Signals / Top Opportunity / Next Trade cards update in place and never
    // blank back to "Computing…" on a transient hiccup (network / auth refresh /
    // rate-limit). signalsOverview always returns ≥1 row, so [] only means failure.
    const next = await api.get<SignalRow[]>('/api/trading/signals').catch(() => null);
    if (next && next.length) setSignals(next);
  }, []);
  const loadIntel = useCallback(async () => {
    // Same: keep the last Intel on a failed refresh instead of blanking the card.
    const next = await api.get<Intel>('/api/trading/intelligence').catch(() => null);
    if (next) setIntel(next);
  }, []);

  const load = useCallback(async () => {
    // Render each card the MOMENT its own data arrives — don't wait for the slowest
    // (Binance) call, which otherwise leaves every card blank for 10–15s on load.
    // Each call sets its state independently; a failed one keeps the last value.
    const tasks = [
      api.get<Account>('/api/trading/account').then(setAccount),
      api.get<Stats>('/api/trading/stats').then(setStats),
      api.get<BotCfg>('/api/bot/status').then(setBot),
      api.get<Position[]>('/api/trading/positions').then((p) => { if (p) setPositions(p); }),
      api.get<Usage>('/api/billing/usage').then(setUsage),
      api.get<Market>('/api/trading/market-status').then(setMarket),
      api.get<Trade[]>('/api/trading/trades').then(setTrades),
      api.get<Perf[]>('/api/trading/performance').then(setPerf),
      api.get<LogItem[]>('/api/bot/log').then(setLog),
      api.get<string[]>('/api/trading/watchlist').then(setWatchlist),
      api.get<BinancePnl>('/api/trading/binance-pnl').then(setBpnl),
    ];
    setLastLoad(Date.now());
    await Promise.allSettled(tasks); // let callers (refreshAll/botAction) await completion
  }, []);

  async function subscribe(plan: 'BASIC' | 'PRO' = 'BASIC') { await api.post('/api/billing/subscribe', { plan }); await load(); }
  async function botAction(action: 'start' | 'pause' | 'stop') { await api.post(`/api/bot/${action}`).catch((e) => alert((e as Error).message)); await load(); }
  async function setPaperMode(paper: boolean) {
    if (paper === bot?.paperTrading) return; // already in that mode
    // Real funds at stake → confirm before going Live. Paper is safe, no prompt.
    if (!paper && !confirm('Switch to LIVE trading? New trades will use REAL funds on your connected Binance account.')) return;
    try { await api.patch('/api/bot/config', { paperTrading: paper }); await load(); }
    catch (e) { alert((e as Error).message); } // e.g. "Close all open positions before switching…"
  }
  async function openDetail(symbol: string) { const trips = await api.get<Trip[]>(`/api/trading/trade-detail?symbol=${symbol}`); setDetail({ symbol, trips }); }
  async function refreshAll() { setRefreshing(true); try { await Promise.all([load(), loadSignals()]); } finally { setRefreshing(false); } }

  useEffect(() => {
    api.refresh().then(() => { load(); loadSignals(); loadIntel(); }).catch(() => { window.location.href = '/login'; });
    api.get<{ id: string }>('/api/me').then(setMe).catch(() => {});
  }, [load, loadSignals, loadIntel]);

  // Steady auto-refresh so every card stays live WITHOUT a manual refresh, even
  // when the realtime WS isn't configured in prod. Account/positions/trades/log are
  // server-cached (~15s), signals are cached 20s server-side — so polling all of
  // them on a tight cadence is cheap (mostly cache hits) yet feels live.
  useEffect(() => {
    const t = setInterval(load, 15_000);          // balances · positions · trades · per-symbol · performance · activity log
    const t2 = setInterval(loadSignals, 20_000);  // live signals · top opportunity · next trade (cached 20s server-side)
    const t3 = setInterval(loadIntel, 45_000);    // AI strategy / learning / news (heavier)
    return () => { clearInterval(t); clearInterval(t2); clearInterval(t3); };
  }, [load, loadSignals, loadIntel]);

  useEffect(() => {
    if (!me) return;
    return openRealtime(
      [CHANNELS.userPositions(me.id), CHANNELS.userPnl(me.id), CHANNELS.userSignals(me.id), CHANNELS.userBotLog(me.id)],
      (m) => { if (m.channel.endsWith(':signals')) loadSignals(); else load(); },
    );
  }, [me, load, loadSignals]);

  // ── Derived analytics (all client-side from data we already have) ───────────
  const d = useMemo(() => deriveAnalytics(trades, signals, perf, bot, market, account, stats), [trades, signals, perf, bot, market, account, stats]);
  const [theme] = useTheme();
  const tc = themeColors(theme);

  return (
    <>
      <AppNav active="dashboard" />
      <main className="p-3 sm:p-4 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">
        {/* Header + bot controls */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">Trading Terminal</h1>
            {market && <span className="text-muted text-sm">BTC <b className={trendColor(market.btcTrend)}>{market.btcTrend}</b>{market.btcPrice ? ` $${market.btcPrice.toLocaleString()}` : ''}</span>}
            <span className="text-xs flex items-center gap-1">
              <span className={account?.live ? 'badge-up animate-pulse' : 'text-warn'}>{account?.live ? '● LIVE' : '○ cached'}</span>
              <span className="text-muted">· auto 20s · updated <Ago at={lastLoad} /></span>
              {stats?.timezone && <span className="text-muted">· 🌐 {regionLabel(stats.timezone)}{stats.lastResetAt ? ` · day reset ${new Date(stats.lastResetAt).toLocaleString()}` : ''}</span>}
            </span>
          </div>
          <div className="flex items-center flex-wrap gap-2 justify-end">
            <ModeToggle paper={bot?.paperTrading} onSet={setPaperMode} />
            <button className="btn text-xs" disabled={refreshing} onClick={refreshAll}>{refreshing ? '…' : '↻ Refresh'}</button>
            <span className={`label ${bot?.status === 'RUNNING' ? 'text-accent' : 'text-muted'}`}>BOT: {bot?.status ?? '…'} · {bot?.mode}</span>
            <button className="btn" onClick={() => botAction('start')}>Start</button>
            <button className="btn" onClick={() => botAction('pause')}>Pause</button>
            <button className="btn-danger" onClick={() => botAction('stop')}>Stop</button>
          </div>
        </header>
        {bot?.pausedReason && <p className="text-warn text-sm">⏸ {bot.pausedReason}</p>}

        {usage?.viewOnly && (
          <div className="card border-warn/50 bg-warn/10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-warn font-bold">⚠ View-Only Mode — subscription {usage.status.toLowerCase()}</p>
              <p className="text-muted text-sm">Bot &amp; AI signals are disabled. Existing positions stay protected. Renew to restore access.</p>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => subscribe('BASIC')}>Basic ${centsToUsd(BILLING.basicMonthlyCents)}/mo</button>
              <button className="btn" onClick={() => subscribe('PRO')}>Pro ${centsToUsd(BILLING.proAnnualCents)}/yr</button>
            </div>
          </div>
        )}

        {/* Usage & Billing — subscription / usage meter (kept at top) */}
        {usage && <UsageMeter u={usage} onSubscribe={subscribe} />}

        {/* What is this bot & how does it work? — explainer (kept at top) */}
        <BotExplainer bot={bot} />

        {/* ═══════════════ TOP — live trading & key numbers ═══════════════ */}

        {/* Portfolio stat cards (key KPIs) */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <LivePortfolioCard account={account} positions={positions} />
          <Card label="Available" value={fmt(account?.availableBalance)} />
          <Card label="In Trade (margin)" value={fmt(account?.marginUsed)} />
          <LiveUnrealizedCard account={account} positions={positions} />
          <LiveTodayCard todayRealized={d.todayPnl} positions={positions} />
          <div className="card">
            <p className="label">Today W/L</p>
            <p className="stat"><span className="badge-up">{d.todayWins}W</span> <span className="text-muted text-base">/</span> <span className="badge-down">{d.todayLosses}L</span></p>
          </div>
          <Card label="ROI" value={`${stats?.roi ?? 0}%`} />
          <Card label="Realized 7D" value={fmt(d.realized7d)} signed />
          <Card label="Profit Factor" value={d.profitFactor} />
          <Card label="Max Drawdown 7D" value={fmt(-d.maxDrawdown)} signed />
          <Card label="Win Rate" value={`${stats?.winRate ?? 0}%`} />
          <Card label="Open Trades" value={String(account?.openPositions ?? 0)} />
        </section>

        {/* Engine activity stat row — sits right after the portfolio KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card label="Decisions (now)" value={String(d.decisions)} />
          <Card label="Trades Taken" value={String(stats?.totalTrades ?? 0)} />
          <Card label="Blocked (now)" value={String(d.blocked)} />
          <Card label="Today" value={`${d.todayTrades.length} / ${bot?.maxTradesPerDay === 0 ? '∞' : (bot?.maxTradesPerDay ?? '—')}`} />
          <Card label="Volume" value={fmt(d.volume)} />
        </section>

        {/* Top Opportunity + Next Trade Preview + Fear & Greed — directly under the KPI rows */}
        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="card md:col-span-2">
            <p className="label mb-2">🎯 Top Opportunity — Live</p>
            {!d.top ? <Empty>No directional candidate right now — bot is standing aside.</Empty> : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-2xl font-bold">{d.top.symbol}{' '}
                    <span className={d.top.bias === 'long' ? 'badge-up' : 'badge-down'}>{d.top.bias.toUpperCase()}</span>
                  </p>
                  <p className="text-muted text-sm mt-1">
                    Score <b className="text-accent">{d.top.score}</b>/100 · threshold {d.top.threshold} ·{' '}
                    {d.top.allPass ? <span className="badge-up">✅ would trade</span> : (
                      <GateDetail s={d.top} botStatus={bot?.status}><span className="text-warn">⏳ {d.top.blocking}</span></GateDetail>
                    )}
                  </p>
                </div>
                <a href={`/chart/${d.top.symbol}`} className="btn">📈 Preview this trade</a>
              </div>
            )}
          </div>
          <div className="card">
            <p className="label mb-2">Next Trade Preview</p>
            {!d.top ? <Empty>No candidate yet</Empty> : (
              <div className="text-sm space-y-1">
                <p className="text-lg font-bold">{d.top.symbol} <span className={d.top.bias === 'long' ? 'badge-up' : 'badge-down'}>{d.top.bias.toUpperCase()}</span></p>
                <Row k="Score" v={<b className="text-accent">{d.top.score}/{d.top.threshold}</b>} />
                <Row k="Leverage" v={`${bot?.leverage ?? '—'}×`} />
                <Row k="Margin" v={`$${bot ? num(bot.marginPerTradeUsd).toFixed(2) : '—'}`} />
                <Row k="Status" v={
                  <GateDetail s={d.top} botStatus={bot?.status}>
                    {d.top.allPass ? <span className="badge-up">READY ⓘ</span> : <span className="text-warn">GATED ⓘ</span>}
                  </GateDetail>
                } />
                <a href={`/chart/${d.top.symbol}`} className="btn text-xs inline-block mt-1">📈 Analyze</a>
              </div>
            )}
          </div>
          <FearGreedCard fg={intel?.fearGreed} tc={tc} />
        </section>

        {/* Account & Trade Detail — current settings (kept at top with the KPIs) */}
        <section className="card">
          <p className="label mb-2">⚙️ Account &amp; Trade Detail — current settings</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1 text-sm">
            <Row k="Mode" v={`${bot?.mode ?? '—'} · ${bot?.status ?? '—'}`} />
            <Row k="Watchlist" v={`${watchlist.length} symbols`} />
            <Row k="Trade size" v={`$${bot ? num(bot.marginPerTradeUsd).toFixed(2) : '—'}${bot?.dynamicSizing ? ' (dynamic)' : ''}`} />
            <Row k="Leverage" v={`${bot?.leverage ?? '—'}×`} />
            <Row k="Order type" v="MARKET · FUTURES" />
            <Row k="SL / TP" v={`${bot ? num(bot.slPercent) : '—'}% / 1:${bot ? num(bot.tpRR) : '—'}`} />
            <Row k="Max concurrent" v={String(bot?.maxConcurrentPositions ?? '—')} />
            <Row k="Daily trades cap" v={String(bot?.maxTradesPerDay ?? '—')} />
            <Row k="Score threshold" v={String(bot?.scoreThreshold ?? '—')} />
            <Row k="Loss cooldown" v={`${bot?.lossCooldownMin ?? '—'} min`} />
            <Row k="Max consec. losses" v={String(bot?.maxConsecutiveLosses ?? '—')} />
            <Row k="Margin guard" v={`${bot?.marginGuardPct ?? '—'}%`} />
            <Row k="Total balance" v={fmt(account?.totalBalance)} />
            <Row k="Available" v={fmt(account?.availableBalance)} />
            <Row k="Margin used" v={fmt(account?.marginUsed)} />
            <Row k="Last synced" v={account?.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleTimeString() : '—'} />
          </div>
        </section>

        {/* Open positions (live, 1s) + Protection status */}
        <section className="grid md:grid-cols-2 gap-6">
          <LivePositions positions={positions} onClosed={load} />
          <div className="card">
            <p className="label mb-2">🛡️ Protection Status — SL/TP per open position</p>
            {positions.length === 0 ? (
              <Empty>No open positions. When you open one, SL/TP planning shows here. Auto-protect: {bot?.useBreakEven || bot?.useTrailingStop ? 'ON' : 'OFF'}</Empty>
            ) : (
              <div className="space-y-2 text-sm">
                {positions.map((p) => {
                  const live = signals.find((s) => s.symbol === p.symbol);
                  const ls = live?.score;
                  const entry = p.entryScore;
                  const arrow = ls != null && entry != null ? (ls > entry ? '↑' : ls < entry ? '↓' : '→') : '';
                  const lsCls = ls == null ? 'text-muted' : ls >= (live?.threshold ?? 80) ? 'badge-up' : entry != null && ls < entry ? 'badge-down' : 'text-warn';
                  return (
                    <div key={p.id} className="border-t border-border pt-2">
                      <p className="font-bold">{p.symbol} <span className={p.side === 'LONG' ? 'badge-up' : 'badge-down'}>{p.side}</span></p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs text-muted mt-1">
                        <span>SL: <b className="text-danger">{p.stopLoss ? num(p.stopLoss).toFixed(4) : '—'}</b></span>
                        <span>TP: <b className="text-accent">{p.takeProfit ? num(p.takeProfit).toFixed(4) : '—'}</b></span>
                        <span>Entry score: <b>{entry ?? '—'}</b></span>
                        <span>Live score: <b className={lsCls}>{ls ?? '—'} {arrow}</b></span>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted pt-1">Break-even: {bot?.useBreakEven ? 'ON' : 'OFF'} · Trailing stop: {bot?.useTrailingStop ? 'ON' : 'OFF'}</p>
              </div>
            )}
          </div>
        </section>

        {/* Dynamic profit protection ladder (live per-second, up to 5 coins) */}
        <section>
          <DynamicProtection positions={positions} signals={signals} slPercent={bot ? num(bot.slPercent) : 1} armPct={num(bot?.trailArmPct) || 0.5} gapPct={num(bot?.trailGapPct) || 0.5} />
        </section>

        {/* AI profit potential — which coin is in a trade + its profit possibility (live) */}
        <section>
          <AiProfitPotential positions={positions} signals={signals} slPercent={bot ? num(bot.slPercent) : 1} tpRR={bot ? num(bot.tpRR) : 3} />
        </section>

        {/* Live Signals — full table */}
        <section className="card overflow-x-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="label">📡 Live Signals — BTC + altcoin calcs right now</p>
            <span className="text-xs">{signals.filter((s) => s.allPass).length > 0
              ? <span className="badge-up animate-pulse">{signals.filter((s) => s.allPass).length} READY ✅</span>
              : <span className="text-muted">0 ready</span>} <span className="text-muted">· {signals.length} watched · {d.blocked} blocked · ↻ 60s</span></span>
          </div>
          {signals.length === 0 ? <Empty>Computing signals…</Empty> : (
            <table className="w-full text-sm min-w-[820px]">
              <thead><tr className="text-muted text-xs">
                <th className="text-left">Symbol</th><th>Bias</th><th>Score</th><th>Verdict</th>
                <th>Trend</th><th>RSI3</th><th>Vol×</th><th>VWAP Δ</th><th>ADX</th>
                <th className="text-left pl-3">What&apos;s blocking</th><th></th>
              </tr></thead>
              <tbody>{signals.map((s) => (
                <tr key={s.symbol} className={`border-t border-border ${s.allPass ? 'bg-accent/10' : ''}`}>
                  <td className="font-bold">{s.symbol}</td>
                  <td className="text-center"><span className={s.bias === 'long' ? 'badge-up' : s.bias === 'short' ? 'badge-down' : 'text-muted'}>{s.bias}</span></td>
                  <td className="text-center"><b className={s.score >= s.threshold ? 'text-accent' : ''}>{s.score}</b></td>
                  <td className={`text-center text-xs ${s.allPass ? 'badge-up' : 'text-muted'}`}>{s.allPass ? '✅ READY' : '🚫'}</td>
                  <td className="text-center text-xs">{s.trend === 'up' ? '↗' : s.trend === 'down' ? '↘' : '→'}</td>
                  <td className="text-center text-xs">{s.rsi3 ?? '—'}</td>
                  <td className="text-center text-xs">{s.volRatio ?? '—'}</td>
                  <td className={`text-center text-xs ${num(s.vwapDeltaPct) >= 0 ? 'badge-up' : 'badge-down'}`}>{s.vwapDeltaPct == null ? '—' : `${s.vwapDeltaPct}%`}</td>
                  <td className="text-center text-xs">{s.adx ?? '—'}</td>
                  <td className="text-left pl-3 text-xs text-muted">{s.blocking}</td>
                  <td className="text-right"><a href={`/chart/${s.symbol}`} className="text-accent text-xs">chart</a></td>
                </tr>))}</tbody>
            </table>
          )}
        </section>

        {/* ═══════════════ BELOW — summaries, charts, history & settings ═══════════════ */}

        {/* Real Binance account P&L — reconciled from the exchange income feed */}
        <BinancePnlPanel data={bpnl} />

        {/* Market status + Equity curve */}
        <section className="grid md:grid-cols-2 gap-6">
          <div className="card">
            <p className="label mb-2">Market Status</p>
            {market ? (
              <div className="text-sm space-y-1">
                <Row k="BTC Trend" v={<span className={trendColor(market.btcTrend)}>{market.btcTrend}</span>} />
                <Row k="Verdict" v={<span className={market.verdict === 'HIGH_RISK' ? 'badge-down' : market.verdict === 'SAFE' ? 'badge-up' : 'text-warn'}>{market.verdict}</span>} />
                <Row k="Fear & Greed" v={`${market.fearGreed.value} · ${market.fearGreed.label}`} />
                {market.fearGreedCmc && (
                  <Row k="↳ CoinMarketCap" v={`${market.fearGreedCmc.value} · ${market.fearGreedCmc.label}`} />
                )}
                <Row k="BTC ATR" v={`${(market.btcAtrPct * 100).toFixed(2)}%`} />
                <Row k="Consecutive losses" v={String(bot?.consecutiveLosses ?? 0)} />
              </div>
            ) : <Empty>Loading…</Empty>}
          </div>
          <div className="card">
            <p className="label mb-2">Equity Curve (cumulative net P&L)</p>
            {d.equity.length === 0 ? <Empty>No closed trades yet</Empty> : (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={d.equity}>
                  <CartesianGrid stroke={tc.border} /><XAxis dataKey="t" hide /><YAxis hide domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tip(tc)} />
                  <Line type="monotone" dataKey="pnl" stroke={tc.accent} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Drawdown chart */}
        {d.drawdown.length > 1 && (
          <section className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="label">Drawdown (peak-to-trough, net P&L)</p>
              <span className="badge-down text-sm">Max {fmt(-d.maxDrawdown)}</span>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={d.drawdown}>
                <defs><linearGradient id="dd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={tc.danger} stopOpacity={0.5} /><stop offset="100%" stopColor={tc.danger} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke={tc.border} /><XAxis dataKey="t" hide /><YAxis hide domain={['auto', 0]} />
                <Tooltip contentStyle={tip(tc)} />
                <Area type="monotone" dataKey="dd" stroke={tc.danger} strokeWidth={1.5} fill="url(#dd)" />
              </AreaChart>
            </ResponsiveContainer>
          </section>
        )}

        {/* Daily Trading Summary */}
        <section className="card space-y-3">
          <p className="label">📅 Daily Trading Summary — today&apos;s trades, conditions &amp; why</p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <MiniStat label="Trades Today" value={`${d.todayTrades.length}`} sub={`${account?.openPositions ?? 0} open now`} />
            <MiniStat label="Win Rate" value={`${d.todayWinRate}%`} sub={`${d.todayWins}W / ${d.todayLosses}L`} />
            <MiniStat label="Today P&L" value={fmt(d.todayPnl)} signed sub="net" />
            <MiniStat label="Market Bias" value={(market?.btcTrend ?? '—').toUpperCase()} sub="BTC-driven" />
            <MiniStat label="Losses Today" value={`${d.todayLosses}`} sub={`${d.blocked} blocked now`} />
            <MiniStat label="Bot Status" value={bot?.status ?? '—'} sub={bot?.mode ?? ''} />
          </div>
          <p className="text-sm text-muted leading-relaxed border-t border-border/70 pt-3">{d.dailyNarrative}</p>
        </section>

        {/* Why the bot trades / held back */}
        <section>
          <p className="label mb-2">🧠 Why the bot trades / held back today</p>
          <div className="grid md:grid-cols-2 gap-3">
            {d.whyCards.map((c, i) => <InfoCard key={i} icon={c.icon} tone={c.tone} text={c.text} />)}
          </div>
        </section>

        {/* Professional read */}
        <section>
          <p className="label mb-2">📈 Professional read &amp; what to do</p>
          <div className="grid md:grid-cols-3 gap-3">
            {d.proRead.map((c, i) => <InfoCard key={i} icon={c.icon} tone={c.tone} text={c.text} />)}
          </div>
        </section>

        {/* Today's trades — per-trade reasoning */}
        <section>
          <p className="label mb-2">📋 Today&apos;s trades — entry/exit value &amp; P&amp;L per trade</p>
          {d.todayTrades.length === 0 ? (
            <div className="card"><Empty>No trades closed today yet. The quality bar (score ≥ {bot?.scoreThreshold ?? 85}) keeps the bot patient.</Empty></div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {d.todayTrades.slice(0, 12).map((t) => <TradeReasonCard key={t.id} t={t} />)}
              </div>
              <p className="text-xs text-muted mt-2">{d.todayTradesFooter}</p>
            </>
          )}
        </section>

        {/* Trade history + Per-symbol P&L */}
        <section className="grid md:grid-cols-2 gap-6">
          <div className="card overflow-x-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="label">🧾 Trade History — recent closed orders <span className="text-muted text-xs font-normal">· ↻ 20s</span></p>
              <a className="text-accent text-xs" href={`${getApiBase()}/api/trading/export/trades.csv`} target="_blank" rel="noreferrer">⤓ CSV</a>
            </div>
            {trades.length === 0 ? <Empty>No trades yet</Empty> : (
              <table className="w-full text-sm">
                <thead><tr className="text-muted text-xs"><th className="text-left">Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Net P&L</th><th>Actual</th><th>Reason</th></tr></thead>
                <tbody>{trades.slice(0, 20).map((t) => {
                  // Actual = price P&L − real Binance fee (matched, else taker estimate) ± funding.
                  const fee = num(t.realFee) !== 0 ? num(t.realFee) : -(num(t.entryPrice) + num(t.exitPrice)) * num(t.quantity) * TAKER_FEE_RATE;
                  const actual = num(t.netPnl) + fee + num(t.funding);
                  return (
                  <tr key={t.id} className="border-t border-border">
                    <td className="text-xs text-muted">{new Date(t.closedAt).toLocaleString()}</td>
                    <td>{t.symbol}</td><td className="text-center"><span className={t.side === 'LONG' ? 'badge-up' : 'badge-down'}>{t.side}</span></td>
                    <td className="text-center text-xs">{num(t.quantity)}</td>
                    <td className={`text-center ${num(t.netPnl) >= 0 ? 'badge-up' : 'badge-down'}`}>{num(t.netPnl).toFixed(3)}</td>
                    <td className={`text-center font-bold ${actual >= 0 ? 'badge-up' : 'badge-down'}`} title="After Binance fees & funding">{actual.toFixed(3)}</td>
                    <td className="text-center text-xs">{t.exitReason}</td>
                  </tr>); })}</tbody>
              </table>
            )}
          </div>
          <div className="card overflow-x-auto">
            <p className="label mb-2">💰 Per-Symbol P&L — who&apos;s making money (last 7D)</p>
            {d.perSymbol7d.length === 0 ? <Empty>No closed trades in the last 7 days</Empty> : (
              <table className="w-full text-sm">
                <thead><tr className="text-muted text-xs"><th className="text-left">Symbol</th><th>Net P&L</th><th>Trades</th><th>W</th><th>L</th><th>Last</th></tr></thead>
                <tbody>{d.perSymbol7d.map((c) => (
                  <tr key={c.symbol} className="border-t border-border cursor-pointer hover:bg-accent/5" onClick={() => openDetail(c.symbol)}>
                    <td className="text-accent whitespace-nowrap">{c.symbol} <a href={`/chart/${c.symbol}`} onClick={(e) => e.stopPropagation()} className="text-xs hover:underline">📈</a></td>
                    <td className={`text-center ${c.netPnl >= 0 ? 'badge-up' : 'badge-down'}`}>{c.netPnl >= 0 ? '+' : ''}{c.netPnl.toFixed(2)}</td>
                    <td className="text-center">{c.trades}</td><td className="text-center badge-up">{c.wins}</td><td className="text-center badge-down">{c.trades - c.wins}</td>
                    <td className="text-center text-xs text-muted">{ago(c.lastClosedAt)}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
        </section>

        {/* Trader Performance Analysis — AI assisted */}
        <section className="card overflow-x-auto space-y-2">
          <p className="label">🤖 Trader Performance Analysis — AI-assisted · click a coin for full detail</p>
          {d.analysis.length === 0 ? <Empty>No completed trades yet</Empty> : (
            <>
              <p className="text-sm text-muted leading-relaxed">{d.analysisSummary}</p>
              <table className="w-full text-sm min-w-[760px]">
                <thead><tr className="text-muted text-xs"><th className="text-left">Coin</th><th>Trades</th><th>W/L</th><th>Win%</th><th>P&L</th><th>Risk</th><th>Sentiment</th><th className="text-left pl-3">AI analysis</th></tr></thead>
                <tbody>{d.analysis.map((c) => (
                  <tr key={c.symbol} className="border-t border-border cursor-pointer hover:bg-accent/5 align-top" onClick={() => openDetail(c.symbol)}>
                    <td className="text-accent font-bold whitespace-nowrap">{c.symbol} <a href={`/chart/${c.symbol}`} onClick={(e) => e.stopPropagation()} className="text-xs hover:underline">📈</a></td>
                    <td className="text-center">{c.trades}</td>
                    <td className="text-center text-xs">{c.wins}/{c.trades - c.wins}</td>
                    <td className="text-center">{c.winRate}%</td>
                    <td className={`text-center ${c.netPnl >= 0 ? 'badge-up' : 'badge-down'}`}>{c.netPnl >= 0 ? '+' : ''}{c.netPnl.toFixed(2)}</td>
                    <td className="text-center"><span className={c.riskScore > 60 ? 'badge-down' : c.riskScore > 35 ? 'text-warn' : 'badge-up'}>{c.riskLabel}</span></td>
                    <td className="text-center text-xs"><span className={c.sentiment === 'Bullish' ? 'badge-up' : c.sentiment === 'Bearish' ? 'badge-down' : 'text-muted'}>{c.sentiment}</span></td>
                    <td className="text-left pl-3 text-xs text-muted max-w-md">{c.analysis}</td>
                  </tr>))}</tbody>
              </table>
              <div className="grid md:grid-cols-3 gap-2 text-xs pt-1">
                <p><span className="badge-up">STRENGTHS</span> {d.strengths}</p>
                <p><span className="badge-down">WEAKNESSES</span> {d.weaknesses}</p>
                <p><span className="text-warn">RISKS</span> {d.risks}</p>
              </div>
            </>
          )}
        </section>

        {/* AI & Strategy Intelligence (regime, active strategy, F&G, learning, news) */}
        <IntelSection intel={intel} />

        {/* Adaptive learning (opt-in) — per-coin quality-bar tuning from your results */}
        <AdaptiveLearningCard enabled={bot?.useAdaptiveLearning} />

        {/* Bot Activity Log (the full settings editor lives in Profile → Setup) */}
        <section className="card">
          <p className="label mb-2">📜 Bot Activity Log</p>
          {log.length === 0 ? <Empty>No activity yet</Empty> : (
            <div className="space-y-1 max-h-72 overflow-auto text-sm">
              {log.map((l) => (
                <div key={l.id} className="border-t border-border/70 py-1">
                  <span className="text-accent">{l.title}</span> <span className="text-muted text-xs">· {new Date(l.createdAt).toLocaleTimeString()}</span>
                  <p className="text-muted text-xs">{l.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {detail && <TradeDetailModal symbol={detail.symbol} trips={detail.trips} onClose={() => setDetail(null)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivations + rule-based narrative (the "AI" the original dashboard used —
// deterministic heuristics over free market signals, no LLM).
// ─────────────────────────────────────────────────────────────────────────────
interface TradeReason extends Trade { reason: string }
function deriveAnalytics(
  trades: Trade[], signals: SignalRow[], perf: Perf[], bot?: BotCfg, market?: Market, account?: Account, stats?: Stats,
) {
  const now = Date.now();
  const sorted = [...trades].sort((a, b) => +new Date(a.closedAt) - +new Date(b.closedAt));

  // cumulative equity + drawdown
  const equity: { t: string; pnl: number }[] = [];
  const drawdown: { t: string; dd: number }[] = [];
  let cum = 0, peak = 0, maxDrawdown = 0;
  for (const tr of sorted) {
    cum += num(tr.netPnl);
    peak = Math.max(peak, cum);
    const dd = cum - peak;
    maxDrawdown = Math.max(maxDrawdown, peak - cum);
    const label = new Date(tr.closedAt).toLocaleDateString();
    equity.push({ t: label, pnl: +cum.toFixed(2) });
    drawdown.push({ t: label, dd: +dd.toFixed(2) });
  }

  const volume = trades.reduce((s, t) => s + num(t.entryPrice) * num(t.quantity), 0);
  const fees = trades.reduce((s, t) => s + num(t.feeUsd), 0);

  const within7 = (t: Trade) => +new Date(t.closedAt) >= now - 7 * DAY;
  const trades7d = trades.filter(within7);
  const realized7d = trades7d.reduce((s, t) => s + num(t.netPnl), 0);
  const gains = trades7d.filter((t) => num(t.netPnl) > 0).reduce((s, t) => s + num(t.netPnl), 0);
  const losses = trades7d.filter((t) => num(t.netPnl) < 0).reduce((s, t) => s + Math.abs(num(t.netPnl)), 0);
  const profitFactor = losses > 0 ? (gains / losses).toFixed(2) : gains > 0 ? '∞' : '—';

  // calendar-today
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const todayAll = trades.filter((t) => +new Date(t.closedAt) >= +startToday)
    .sort((a, b) => +new Date(b.closedAt) - +new Date(a.closedAt));
  const todayTrades: TradeReason[] = todayAll.map((t) => ({ ...t, reason: tradeReason(t) }));
  const todayWins = todayTrades.filter((t) => num(t.netPnl) > 0).length;
  const todayLosses = todayTrades.filter((t) => num(t.netPnl) < 0).length;
  const todayPnl = todayTrades.reduce((s, t) => s + num(t.netPnl), 0);
  const todayWinRate = todayTrades.length ? Math.round((todayWins / todayTrades.length) * 100) : 0;

  const directional = signals.filter((s) => s.bias !== 'none');
  const top = [...directional].sort((a, b) => b.score - a.score)[0] ?? null;
  const longSetups = signals.filter((s) => s.bias === 'long').length;
  const shortSetups = signals.filter((s) => s.bias === 'short').length;
  const qualifying = signals.filter((s) => s.allPass).length;
  const decisions = signals.length;
  const blocked = signals.filter((s) => !s.allPass).length;
  const threshold = bot?.scoreThreshold ?? 85;
  const btc = market?.btcTrend ?? 'neutral';

  // most common blocking reasons
  const blkTally = new Map<string, number>();
  for (const s of signals) if (!s.allPass && s.bias !== 'none') blkTally.set(s.blocking, (blkTally.get(s.blocking) ?? 0) + 1);
  const topBlocks = [...blkTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  // narrative
  const dailyNarrative = todayTrades.length === 0
    ? `No trades closed today. ${btc === 'bearish' ? 'BTC is bearish so long alt setups are gated' : btc === 'bullish' ? 'BTC is bullish — the bot favours longs' : 'BTC is neutral'}, and the ${threshold}-score quality bar only passes the best setups. Best setups still forming below ${threshold}.`
    : `Today: ${todayTrades.length} trade${todayTrades.length > 1 ? 's' : ''} closed (${todayWins}W/${todayLosses}L, ${todayWinRate}% win rate) for ${todayPnl >= 0 ? '+' : ''}$${todayPnl.toFixed(2)}. ${btc === 'bearish' ? 'Frequency is low because BTC is bearish (longs gated), plus' : 'On top of that,'} the ${threshold}-score quality bar only passes the best setups.`;

  const tone = (t: 'info' | 'warn' | 'good' | 'blue'): InfoTone => t;
  const whyCards: { icon: string; tone: InfoTone; text: string }[] = [
    { icon: bot?.status === 'RUNNING' ? '🟢' : '📉', tone: tone(bot?.status === 'RUNNING' ? 'good' : 'info'),
      text: bot?.status === 'RUNNING' ? 'The live bot is running and evaluating every watchlist coin each tick.' : `The bot is ${bot?.status?.toLowerCase() ?? 'stopped'} — signals below are computed but no orders fire until you Start it.` },
    { icon: '🟦', tone: tone('blue'),
      text: btc === 'bearish' ? 'BTC is BEARISH — the alt-long critical gate blocks every LONG alt setup. Only shorts can fire.'
        : btc === 'bullish' ? 'BTC is BULLISH — the trend favours longs; short alt setups face the counter-trend gate.'
        : 'BTC is NEUTRAL — both directions are allowed; the score bar does the filtering.' },
    { icon: '🟧', tone: tone('warn'),
      text: topBlocks.length ? `Most common blockers right now: ${topBlocks.map(([b, n]) => `${b} (${n})`).join('; ')}.` : 'No recurring blockers — conditions are clean across the watchlist.' },
    { icon: qualifying > 0 ? '🟩' : '⚪', tone: tone(qualifying > 0 ? 'good' : 'info'),
      text: qualifying > 0 ? `${qualifying} coin${qualifying > 1 ? 's' : ''} clear${qualifying > 1 ? '' : 's'} the ${threshold} score bar and would trade on the next tick.` : `No coin clears the ${threshold} score threshold yet — by design the bot waits for high-quality setups. Quiet days are expected.` },
  ];

  const edge = shortSetups > longSetups ? 'SHORT' : longSetups > shortSetups ? 'LONG' : 'BALANCED';
  const proRead: { icon: string; tone: InfoTone; text: string }[] = [
    { icon: '⚪', tone: tone('info'), text: `Limits: concurrency ${bot?.maxConcurrentPositions ?? 1} position(s), score threshold ${threshold}, max ${bot?.maxTradesPerDay ?? '—'} trades/day.` },
    { icon: '🟧', tone: tone('warn'),
      text: edge === 'BALANCED' ? `Edge is balanced (${longSetups} long / ${shortSetups} short setups). No strong directional lean — let the score bar decide.`
        : `Edge today leans ${edge} (${shortSetups} short / ${longSetups} long setups). BTC is ${btc} — ${edge === 'SHORT' && btc === 'bearish' || edge === 'LONG' && btc === 'bullish' ? `${edge} is the trend-aligned, higher-probability side, and the bot is correctly favouring it.` : 'watch for counter-trend risk.'}` },
    { icon: '🟦', tone: tone('blue'),
      text: qualifying > 0 ? `${qualifying} setup(s) qualify — the bot will take them on the next tick if margin and daily caps allow.`
        : `Setups are forming below ${threshold}. Either hold for quality, or lower the score threshold (e.g. ${Math.max(70, threshold - 7)}) to capture trend-aligned ${edge.toLowerCase()}s. Do NOT force counter-trend trades against BTC.` },
  ];

  const todayTradesFooter = todayLosses > todayWins
    ? 'Red today. Losses hitting the stop is the protection working — judge over many trades; the strict score bar + ADX gate aim to reduce those.'
    : todayTrades.length > 0 ? 'Green today — winners came from trend-aligned, high-score entries. Keep the quality bar where it is.' : '';

  // per-symbol 7d
  const bySym = new Map<string, { netPnl: number; trades: number; wins: number; lastClosedAt: string }>();
  for (const t of trades7d) {
    const c = bySym.get(t.symbol) ?? { netPnl: 0, trades: 0, wins: 0, lastClosedAt: t.closedAt };
    c.netPnl += num(t.netPnl); c.trades++; if (num(t.netPnl) > 0) c.wins++;
    if (+new Date(t.closedAt) > +new Date(c.lastClosedAt)) c.lastClosedAt = t.closedAt;
    bySym.set(t.symbol, c);
  }
  const perSymbol7d = [...bySym.entries()].map(([symbol, c]) => ({ symbol, ...c, netPnl: +c.netPnl.toFixed(2) }))
    .sort((a, b) => b.netPnl - a.netPnl);

  // trader analysis (enrich perf with sentiment + text)
  const analysis = perf.map((c) => ({
    ...c,
    riskLabel: c.riskScore > 60 ? 'HIGH' : c.riskScore > 35 ? 'MOD' : 'LOW',
    sentiment: c.winRate >= 60 && c.netPnl >= 0 ? 'Bullish' : c.winRate <= 40 || c.netPnl < 0 ? 'Bearish' : 'Neutral',
    analysis: coinAnalysis(c),
  }));
  const best = [...perf].sort((a, b) => b.netPnl - a.netPnl)[0];
  const worst = [...perf].sort((a, b) => a.netPnl - b.netPnl)[0];
  const totalTrades = perf.reduce((s, c) => s + c.trades, 0);
  const totalPnl = perf.reduce((s, c) => s + c.netPnl, 0);
  const avgWin = stats?.winRate ?? 0;
  const avgRisk = perf.length ? Math.round(perf.reduce((s, c) => s + c.riskScore, 0) / perf.length) : 0;
  const portfolioRisk = avgRisk > 60 ? 'HIGH' : avgRisk > 35 ? 'MODERATE' : 'LOW';
  const analysisSummary = perf.length
    ? `Over the recent period you took ${totalTrades} trade${totalTrades > 1 ? 's' : ''} across ${perf.length} coin${perf.length > 1 ? 's' : ''} at a ${avgWin}% win rate for ${totalPnl >= 0 ? 'a gain of +' : 'a loss of '}$${Math.abs(totalPnl).toFixed(2)}. Best: ${best?.symbol ?? '—'}. Weakest: ${worst?.symbol ?? '—'}. Current portfolio risk ${portfolioRisk}.`
    : '';
  const strengths = best && best.netPnl > 0 ? `${best.symbol} is your most profitable coin (+$${best.netPnl.toFixed(2)}); trend-aligned entries are working.` : 'Discipline: the quality bar is keeping you out of low-probability trades.';
  const weaknesses = worst && worst.netPnl < 0 ? `${worst.symbol} is dragging the book (${worst.netPnl.toFixed(2)}); consider tightening its filter or pausing it.` : 'No major loser — losses are well-contained by the stop.';
  const risks = `Portfolio risk ${portfolioRisk}. Keep concurrency at ${bot?.maxConcurrentPositions ?? 1} and respect the ${bot?.maxTradesPerDay ?? '—'}-trade daily cap; don't fight a ${btc} BTC.`;

  return {
    equity, drawdown, maxDrawdown, volume, fees, realized7d, profitFactor,
    decisions, blocked, top, todayTrades, todayWins, todayLosses, todayPnl, todayWinRate,
    dailyNarrative, whyCards, proRead, todayTradesFooter, perSymbol7d,
    analysis, analysisSummary, strengths, weaknesses, risks,
  };
}

type InfoTone = 'info' | 'warn' | 'good' | 'blue';

function tradeReason(t: Trade): string {
  const pnl = num(t.netPnl);
  const dur = t.durationSec ? `${Math.round(t.durationSec / 60)}m` : '';
  const r = t.exitReason;
  const dir = t.side === 'LONG' ? 'long' : 'short';
  if (r === 'TP') return `${dir} hit take-profit${dur ? ` after ${dur}` : ''} — full target reached. +$${pnl.toFixed(2)}.`;
  if (r === 'TRAIL') return `${dir} trailing stop locked in profit as the move extended${dur ? ` over ${dur}` : ''}. +$${pnl.toFixed(2)}.`;
  if (r === 'SL') return pnl < 0 ? `${dir} stopped out${dur ? ` after ${dur}` : ''} — trend failed to follow through. $${pnl.toFixed(2)} (protection working).` : `${dir} break-even stop protected the entry. $${pnl.toFixed(2)}.`;
  if (r === 'LIQUIDATION') return `${dir} liquidated — outsized adverse move.`;
  if (r === 'MANUAL' || r === 'EXTERNAL') return `${dir} closed manually/outside the bot. ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}.`;
  return `${dir} closed. ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}.`;
}

function coinAnalysis(c: Perf): string {
  const l = c.trades - c.wins;
  if (c.trades === 0) return 'No completed trades.';
  if (c.netPnl > 0 && c.winRate >= 55) return `Strong: ${c.wins}/${c.trades} winners, +$${c.netPnl.toFixed(2)}. Setups here are aligning with the trend — keep trading it as configured.`;
  if (c.netPnl > 0) return `Net positive (+$${c.netPnl.toFixed(2)}) despite a ${c.winRate}% win rate — winners are larger than losers (good R:R). Sustainable if R:R holds.`;
  if (c.netPnl < 0 && c.winRate < 40) return `Weak: ${l}/${c.trades} losses, ${c.netPnl.toFixed(2)}. Low win rate suggests this coin's setups are fighting the trend — tighten its filter or pause it.`;
  return `Roughly break-even (${c.netPnl.toFixed(2)}, ${c.winRate}% win). Needs more samples before judging; the stop is containing the losers.`;
}

/**
 * Live ⇄ Paper trading switch. Paper = simulated (no real orders); Live = real
 * funds on the connected Binance account. The backend rejects a switch while any
 * position is open (the watchdog branches on this flag), surfaced via the catch
 * in setPaperMode. Distinct from the "● LIVE / ○ cached" data-freshness badge.
 */
function ModeToggle({ paper, onSet }: { paper?: boolean; onSet: (paper: boolean) => void }) {
  return (
    <span className="inline-flex items-center rounded border border-border overflow-hidden text-xs"
      title="Switch between Paper (simulated) and Live (real-money) trading. Close open positions first.">
      <button type="button" onClick={() => onSet(true)}
        className={`px-2 py-1 font-bold transition ${paper ? 'bg-warn/30 text-warn' : 'text-muted hover:text-fg'}`}>
        🧪 Paper
      </button>
      <button type="button" onClick={() => onSet(false)}
        className={`px-2 py-1 font-bold transition ${paper === false ? 'bg-danger/30 text-danger' : 'text-muted hover:text-fg'}`}>
        💵 Live
      </button>
    </span>
  );
}

/**
 * Real Binance account P&L — the TRUE wallet change from trading (realized PnL +
 * exchange fees + funding), reconciled from Binance's income feed. Shows fees and
 * any activity the bot didn't record, so it matches the wallet exactly.
 */
function BinancePnlPanel({ data }: { data?: BinancePnl }) {
  if (!data) return null;
  if (!data.live) {
    return (
      <section className="card">
        <p className="label mb-1">💼 Real Binance P&L (today · 7d)</p>
        <Empty>{data.paper
          ? 'Paper mode — simulated trades only. Real-account P&L appears here in Live mode.'
          : 'Connect a valid Binance key to see your real account P&L (realized + fees + funding).'}</Empty>
      </section>
    );
  }
  const Bucket = ({ b, label }: { b?: PnlBucket; label: string }) => {
    if (!b) return null;
    return (
      <div className="bg-bg rounded p-3 border border-border">
        <p className="label mb-1">{label}</p>
        <p className={`text-xl font-bold ${b.net >= 0 ? 'badge-up' : 'badge-down'}`}>{b.net >= 0 ? '+' : ''}{b.net.toFixed(2)} USDT</p>
        <div className="grid grid-cols-2 gap-x-3 text-xs text-muted mt-1">
          <span>Realized</span><span className={`text-right ${b.realizedPnl >= 0 ? 'text-accent' : 'text-danger'}`}>{b.realizedPnl >= 0 ? '+' : ''}{b.realizedPnl.toFixed(2)}</span>
          <span>Fees</span><span className="text-right text-danger">{b.fees.toFixed(2)}</span>
          <span>Funding</span><span className={`text-right ${b.funding >= 0 ? 'text-accent' : 'text-danger'}`}>{b.funding >= 0 ? '+' : ''}{b.funding.toFixed(2)}</span>
          <span>Closed trades</span><span className="text-right">{b.trades}</span>
        </div>
      </div>
    );
  };
  return (
    <section className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="label">💼 Real Binance P&L — actual wallet (incl. fees &amp; funding)</p>
        <span className="text-xs badge-up">● from Binance · 60s</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Bucket b={data.today} label="Today (UTC)" />
        <Bucket b={data.week} label="Last 7 days" />
      </div>
      <p className="text-xs text-muted mt-2">Your true account change from trading — includes Binance fees/funding and any activity (even trades the bot didn’t record), so it matches your wallet exactly. The Trade History below is the bot’s own record.</p>
    </section>
  );
}

/** Self-ticking "Xs/Xm ago" — isolated so it re-renders alone, not the dashboard. */
function Ago({ at }: { at: number }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return <span>{s < 60 ? `${s}s` : `${Math.round(s / 60)}m`} ago</span>;
}

/** Poll the cheap public last-price feed every 1s for the given symbols (cached
 *  server-side). Isolated in components that use it so only they re-render. */
function useLivePrices(symbols: string[]): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const symKey = symbols.join(',');
  useEffect(() => {
    if (!symKey) { setPrices({}); return; }
    let alive = true;
    const tick = async () => {
      try { const p = await api.get<Record<string, number>>(`/api/trading/ticker?symbols=${symKey}`); if (alive) setPrices(p); } catch { /* keep last */ }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [symKey]);
  return prices;
}

/**
 * Open Positions with LIVE per-second PnL. Recomputes mark / PnL% / ROE / PnL$
 * locally from the 1s price feed. Self-contained so the tick re-renders just this
 * card — the rest of the (heavy) dashboard stays still.
 */
function LivePositions({ positions, onClosed }: { positions: Position[]; onClosed: () => void }) {
  const prices = useLivePrices(positions.map((p) => p.symbol));
  const [busy, setBusy] = useState('');
  async function closeNow(p: Position) {
    if (!confirm(`Close ${p.side} ${p.symbol} now at market price?`)) return;
    setBusy(p.id);
    try { await api.post(`/api/trading/positions/${p.id}/close`); onClosed(); }
    catch (e) { alert((e as Error).message); } finally { setBusy(''); }
  }
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="label">Open Positions</p>
        <span className="text-xs badge-up animate-pulse">● LIVE · 1s</span>
      </div>
      {positions.length === 0 ? <Empty>No open positions</Empty> : (
        <table className="w-full text-sm">
          <thead><tr className="text-muted text-xs"><th className="text-left">Symbol</th><th>Entry → Mark</th><th>PnL %</th><th>ROE</th><th>PnL $</th><th>SL/TP</th><th></th></tr></thead>
          <tbody>{positions.map((p) => {
            const long = p.side === 'LONG';
            const entry = num(p.entryPrice);
            const mark = prices[p.symbol] ?? num(p.markPrice);
            const frac = entry > 0 ? (long ? (mark - entry) / entry : (entry - mark) / entry) : 0;
            const pct = frac * 100;
            const roe = pct * (p.leverage || 1);
            const usd = (long ? mark - entry : entry - mark) * num(p.quantity);
            const cls = frac >= 0 ? 'badge-up' : 'badge-down';
            return (
              <tr key={p.id} className="border-t border-border">
                <td>{p.symbol} <span className={long ? 'badge-up text-xs' : 'badge-down text-xs'}>{p.side}</span> <a href={`/chart/${p.symbol}`} className="text-accent text-xs hover:underline">📈</a></td>
                <td className="text-center text-xs">{entry.toFixed(4)} → <b>{mark.toFixed(4)}</b></td>
                <td className={`text-center ${cls}`}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</td>
                <td className={`text-center text-xs ${cls}`}>{roe >= 0 ? '+' : ''}{roe.toFixed(1)}%</td>
                <td className={`text-right ${cls}`}>{usd >= 0 ? '+' : ''}{usd.toFixed(3)}</td>
                <td className="text-center text-xs text-muted">{p.stopLoss ? num(p.stopLoss).toFixed(2) : '—'}/{p.takeProfit ? num(p.takeProfit).toFixed(2) : '—'}</td>
                <td className="text-right"><button className="btn-danger text-xs disabled:opacity-40" disabled={busy === p.id} onClick={() => closeNow(p)}>{busy === p.id ? '…' : '✕ Close'}</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

/**
 * 🛡️ Dynamic Profit Protection — the live profit-lock ladder for up to 5 coins.
 * Shows the rungs (stop ratchets up as profit grows, never back; +5% closes),
 * each OPEN position's live progress on the ladder, AND the top candidate coins
 * the bot is watching (filled to ~5 total) — all live (1s), each with an Open
 * Chart button. Uses the SAME ladder constants as the engine.
 */
function DynamicProtection({ positions, signals, slPercent, armPct, gapPct }: { positions: Position[]; signals: SignalRow[]; slPercent: number; armPct: number; gapPct: number }) {
  const held = new Set(positions.map((p) => p.symbol));
  const watching = [...signals].filter((s) => !held.has(s.symbol))
    .sort((a, b) => (b.allPass ? 1 : 0) - (a.allPass ? 1 : 0) || b.score - a.score) // ready-to-trade first
    .slice(0, Math.max(0, 5 - positions.length));
  const readyCount = signals.filter((s) => !held.has(s.symbol) && s.allPass).length;
  const prices = useLivePrices([...positions.map((p) => p.symbol), ...watching.map((w) => w.symbol)]);
  // Per-position high-water mark (max profit fraction reached). Kept in a ref so it
  // survives the 1s re-renders and only ever ratchets UP — it shows how far a trade
  // got even after the live profit retraces. Floored by the persisted stop's locked
  // level so it stays sensible across a page reload.
  const peaksRef = useRef<Record<string, number>>({});
  const chartBtn = (sym: string) => <a href={`/chart/${sym}`} className="text-accent text-xs hover:underline">📈 chart</a>;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="label">🛡️ Dynamic Profit Protection</p>
        <span className="text-xs badge-up animate-pulse">● LIVE · 1s · up to 5 coins</span>
      </div>
      <p className="text-xs text-muted mb-1">
        Arms at <b className="text-fg">+{armPct}%</b> profit, then trails <b className="text-fg">{gapPct}%</b> behind — the stop only ratchets up, never back. Initial stop <b className="text-warn">−{slPercent}%</b> · closes at <b className="text-accent">+{(PROFIT_TAKE_CAP * 100).toFixed(0)}%</b>.
      </p>
      <p className="text-[11px] text-muted mb-2">Tune “Arm trailing +%” and “Trail gap %” in ⚙️ Bot Settings.</p>

      {/* Active positions — live ladder progress */}
      <div className="border-t border-border/70 mt-3 pt-2 space-y-3">
        {positions.length === 0 ? <p className="text-muted text-xs">No open positions yet — protection activates the moment a trade opens. Candidates below 👇</p> :
          positions.map((p) => {
            const long = p.side === 'LONG';
            const entry = num(p.entryPrice);
            const mark = prices[p.symbol] ?? num(p.markPrice);
            const frac = entry > 0 ? (long ? (mark - entry) / entry : (entry - mark) / entry) : 0;
            const pct = frac * 100;
            // The shown stop is the bot's REAL persisted stop (which only ratchets UP,
            // never back). We also look at the rung for the current profit and take the
            // HIGHER, so the locked % never drops when profit retraces. Previously this
            // recomputed purely from live profit, so a dip from +1.0%→+0.8% made the
            // shown lock fall +0.5%→+0.2% even though the real stop hadn't moved.
            const sl = p.stopLoss != null ? num(p.stopLoss) : null;
            const stopLockFrac = sl != null ? (long ? (sl - entry) / entry : (entry - sl) / entry) : null;
            // Live trail lock from the user's settings: once profit ≥ arm%, the stop
            // trails gap% behind (floored at break-even). Take the higher of that and
            // the REAL persisted stop so the shown lock never drops on a retrace.
            const arm = armPct / 100, gap = gapPct / 100;
            const trailLock = frac >= arm ? Math.max(0, frac - gap) : null;
            const lock = (stopLockFrac != null && stopLockFrac > 0)
              ? Math.max(stopLockFrac, trailLock ?? 0)
              : trailLock;
            const stopLabel = lock != null && lock > 0 ? `+${(lock * 100).toFixed(2)}% locked`
              : lock != null ? 'break-even locked' : `−${slPercent}% (initial)`;
            const nextLabel = frac >= PROFIT_TAKE_CAP ? 'closing at +5%'
              : frac >= arm ? `trailing ${gapPct}% behind`
              : `arms at +${armPct}%`;
            const prog = Math.max(0, Math.min(100, (frac / PROFIT_TAKE_CAP) * 100));
            // High-water mark: max of (live profit, prior peak, the locked-stop level the
            // trade must have reached for the stop to ratchet there). Ratchets UP only.
            const peakFrac = Math.max(peaksRef.current[p.id] ?? 0, frac, stopLockFrac ?? 0);
            peaksRef.current[p.id] = peakFrac;
            // Show the max-reached profit % only while in profit and retraced from a
            // higher point; when negative, nothing extra is shown.
            const showPeak = frac >= 0 && peakFrac > frac + 1e-6;
            const cls = frac >= 0 ? 'badge-up' : 'badge-down';
            return (
              <div key={p.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">{p.symbol} <span className={long ? 'badge-up' : 'badge-down'}>{p.side}</span> {chartBtn(p.symbol)}</span>
                  <span className="flex items-center gap-1.5">
                    {showPeak && <span className="text-[10px] leading-none px-1 py-0.5 rounded bg-accent/20 text-accent" title="Max profit reached">max +{(peakFrac * 100).toFixed(2)}%</span>}
                    <span className={cls}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
                  </span>
                </div>
                <div className="h-2 bg-bg rounded overflow-hidden border border-border my-1">
                  <div className={`h-full ${frac >= 0 ? 'bg-accent' : 'bg-danger'}`} style={{ width: `${prog}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>stop: <b className={lock != null ? 'text-accent' : 'text-warn'}>{stopLabel}</b></span>
                  <span>{nextLabel}</span>
                </div>
              </div>
            );
          })}
      </div>

      {/* Watching — top candidate coins (live), filled to ~5 total */}
      {watching.length > 0 && (
        <div className="border-t border-border/70 mt-3 pt-2">
          <p className="text-xs mb-1">
            <span className="text-muted">👀 Watching ({watching.length}) — top candidates, protection arms on entry · </span>
            {readyCount > 0 ? <span className="badge-up animate-pulse">{readyCount} READY to trade ✅</span> : <span className="text-muted">none ready yet</span>}
          </p>
          <div className="space-y-1">
            {watching.map((w) => {
              const live = prices[w.symbol];
              return (
                <div key={w.symbol} className={`flex items-center justify-between text-sm border-t border-border/60 py-1 ${w.allPass ? 'bg-accent/10 rounded px-1' : ''}`}>
                  <span className="flex items-center gap-2">
                    {w.symbol}
                    <span className={w.bias === 'long' ? 'badge-up text-xs' : w.bias === 'short' ? 'badge-down text-xs' : 'text-muted text-xs'}>{w.bias === 'none' ? 'neutral' : w.bias}</span>
                    {w.allPass
                      ? <span className="badge-up text-xs animate-pulse">✅ READY</span>
                      : <span className="text-muted text-xs">watching</span>}
                    {chartBtn(w.symbol)}
                  </span>
                  <span className="text-xs text-muted">score <b className={w.score >= w.threshold ? 'text-accent' : ''}>{w.score}</b>/{w.threshold}{live ? ` · $${live.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 🤖 AI Profit Potential — for each coin CURRENTLY in a trade, the AI's live read of
 * how much profit % is still on the table to its target and the confidence (live
 * multi-indicator agreement score) that the move completes — plus the top candidate
 * coins the bot would target next. Same deterministic rule-based engine as the live
 * signals (free market data, not a paid feed) — an estimate, not a guarantee.
 */
function AiProfitPotential({ positions, signals, slPercent, tpRR }: { positions: Position[]; signals: SignalRow[]; slPercent: number; tpRR: number }) {
  const held = new Set(positions.map((p) => p.symbol));
  const prices = useLivePrices(positions.map((p) => p.symbol));
  const candidates = [...signals].filter((s) => !held.has(s.symbol) && s.bias !== 'none')
    .sort((a, b) => b.score - a.score).slice(0, 3);
  const probCls = (p: number) => p >= 75 ? 'badge-up' : p >= 55 ? 'text-warn' : 'text-muted';

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="label">🤖 AI Profit Potential — current trades</p>
        <span className="text-xs badge-up animate-pulse">● LIVE · 1s</span>
      </div>
      <p className="text-[11px] text-muted mb-2">Per coin in a trade: remaining upside to its AI target and the confidence the move completes (live multi-indicator agreement). An estimate from free market signals — not a guarantee.</p>

      {positions.length === 0 ? (
        <Empty>No open trades right now — the top candidates the AI would target are below 👇</Empty>
      ) : (
        <div className="space-y-3">
          {positions.map((p) => {
            const long = p.side === 'LONG';
            const entry = num(p.entryPrice);
            const mark = prices[p.symbol] ?? num(p.markPrice);
            const tp = p.takeProfit != null ? num(p.takeProfit) : null;
            const captured = entry > 0 ? (long ? (mark - entry) / entry : (entry - mark) / entry) * 100 : 0;
            const upside = tp != null && mark > 0 ? Math.max(0, (long ? (tp - mark) / mark : (mark - tp) / mark) * 100) : null;
            const totalTarget = tp != null && entry > 0 ? (long ? (tp - entry) / entry : (entry - tp) / entry) * 100 : null;
            const live = signals.find((s) => s.symbol === p.symbol);
            const prob = live?.score ?? p.entryScore ?? null; // live AI confidence (multi-indicator agreement)
            const trendTxt = prob != null && p.entryScore != null
              ? (prob > p.entryScore ? '↑ strengthening' : prob < p.entryScore ? '↓ weakening' : '→ steady') : undefined;
            const prog = totalTarget && totalTarget > 0 ? Math.max(0, Math.min(100, (captured / totalTarget) * 100)) : 0;
            return (
              <div key={p.id} className="border-t border-border/70 pt-2">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="flex items-center gap-2 font-medium">{p.symbol} <span className={long ? 'badge-up' : 'badge-down'}>{p.side}</span></span>
                  <span className="text-xs">AI confidence <b className={probCls(prob ?? 0)}>{prob ?? '—'}%</b></span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Upside to target" value={upside != null ? `+${upside.toFixed(2)}%` : '—'} sub={totalTarget != null ? `full +${totalTarget.toFixed(1)}%` : undefined} />
                  <MiniStat label="Captured" value={`${captured >= 0 ? '+' : ''}${captured.toFixed(2)}%`} signed />
                  <MiniStat label="Move likelihood" value={prob != null ? `${prob}%` : '—'} sub={trendTxt} />
                </div>
                <div className="h-1.5 bg-bg rounded overflow-hidden border border-border mt-1"><div className="h-full bg-accent" style={{ width: `${prog}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="border-t border-border/70 mt-3 pt-2">
          <p className="text-xs text-muted mb-1">🔮 Next candidates the AI would target (profit potential if entered):</p>
          <div className="space-y-1">
            {candidates.map((c) => (
              <div key={c.symbol} className="flex items-center justify-between text-xs border-t border-border/60 py-1">
                <span className="flex items-center gap-2">{c.symbol}
                  <span className={c.bias === 'long' ? 'badge-up text-xs' : 'badge-down text-xs'}>{c.bias}</span>
                  {c.allPass && <span className="badge-up text-xs animate-pulse">✅ READY</span>}
                </span>
                <span className="text-muted">potential <b className="text-accent">+{(slPercent * tpRR).toFixed(1)}%</b> · confidence <b className={probCls(c.score)}>{c.score}%</b></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** AI & Strategy Intelligence: regime + active strategy, strategy performance,
 *  Fear & Greed, trade learning/feedback, and market intelligence (§17-22). */
function IntelSection({ intel }: { intel?: Intel }) {
  if (!intel) return <section className="card"><Empty>Loading AI &amp; strategy intelligence…</Empty></section>;
  const { strategy: st, learning: lr, marketIntel: mi } = intel;
  const regimeCls = st.regime.includes('UP') ? 'badge-up' : st.regime.includes('DOWN') ? 'badge-down' : st.regime === 'VOLATILE' ? 'text-warn' : 'text-muted';
  return (
    <>
      <section className="grid md:grid-cols-2 gap-4 md:gap-6">
        {/* AI Learning Center */}
        <div className="card">
          <p className="label mb-2">🧠 AI Learning Center</p>
          <div className="text-sm space-y-1">
            <Row k="Market regime" v={<span className={regimeCls}>{st.regimeLabel}</span>} />
            <Row k="Active strategy" v={<b className="text-accent">{st.primary.name}</b>} />
            <Row k="Confidence" v={`${st.confidence}%`} />
            <div className="h-1.5 bg-bg rounded overflow-hidden border border-border"><div className="h-full bg-accent" style={{ width: `${st.confidence}%` }} /></div>
            <p className="text-muted text-xs pt-1">{st.reason}</p>
            <div className="border-t border-border/70 pt-1 mt-1">
              <p className="text-accent text-xs">Top winning conditions</p>
              <ul className="text-muted text-xs">{lr.topWinning.slice(0, 3).map((c, i) => <li key={i}>✅ {c}</li>)}</ul>
              <p className="text-danger text-xs mt-1">Top losing conditions</p>
              <ul className="text-muted text-xs">{lr.topLosing.slice(0, 3).map((c, i) => <li key={i}>🚫 {c}</li>)}</ul>
            </div>
            <p className="text-muted text-[10px] pt-1">Monitoring · {st.library.total} strategies in library ({st.library.implemented} live) · regime gate ADX {st.metrics.adx}, ATR {st.metrics.atrPct}%</p>
          </div>
        </div>

        {/* Strategy Performance */}
        <div className="card">
          <p className="label mb-2">📈 Strategy Performance</p>
          <div className="text-sm space-y-1">
            <Row k="Strategies active (this regime)" v={`${st.active.length} / ${st.library.total}`} />
            <Row k="Win rate" v={`${lr.winRate}%`} /><Row k="Profit factor" v={lr.profitFactor === 999 ? '∞' : lr.profitFactor} />
            <Row k="Best coin" v={lr.best[0] ? <span className="badge-up">{lr.best[0].symbol} +${lr.best[0].netPnl.toFixed(2)}</span> : '—'} />
            <Row k="Worst coin" v={lr.worst[0] && lr.worst[0].netPnl < 0 ? <span className="badge-down">{lr.worst[0].symbol} {lr.worst[0].netPnl.toFixed(2)}</span> : '—'} />
            <div className="border-t border-border/70 pt-1 mt-1 text-xs">
              <p className="text-muted">Exits: {Object.entries(lr.byReason).map(([r, v]) => `${r} ${v.count}`).join(' · ') || '—'}</p>
              <p className="text-accent mt-1">Avoid in this regime:</p>
              <p className="text-muted">{st.avoid.length ? st.avoid.join(', ') : 'none — all families fit'}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4 md:gap-6">
        {/* Trade Learning & Feedback */}
        <div className="card">
          <p className="label mb-2">🎓 Trade Learning &amp; Feedback</p>
          {lr.lessons.length > 0 && <ul className="text-sm text-muted space-y-1 mb-2">{lr.lessons.map((l, i) => <li key={i}>• {l}</li>)}</ul>}
          {lr.recent.length === 0 ? <Empty>No completed trades yet — feedback appears after the first close.</Empty> : (
            <div className="space-y-2 max-h-64 overflow-auto">
              {lr.recent.map((f) => (
                <div key={f.id} className="border-t border-border/70 pt-1 text-xs">
                  <p className="flex justify-between"><span>{f.symbol} <span className={f.side === 'LONG' ? 'badge-up' : 'badge-down'}>{f.side}</span> · {f.reason}</span>
                    <span className={f.win ? 'badge-up' : 'badge-down'}>{f.netPnl >= 0 ? '+' : ''}{f.netPnl}</span></p>
                  <p className="text-muted">✅ {f.worked}{!f.win && ` · 🚫 ${f.failed}`}</p>
                  <p className="text-accent">💡 {f.suggestion}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Market Intelligence */}
        <div className="card">
          <div className="flex items-center justify-between mb-2"><p className="label">📰 Market Intelligence</p><span className={mi.sentiment === 'Bullish' ? 'badge-up' : mi.sentiment === 'Bearish' ? 'badge-down' : 'text-warn'}>{mi.sentiment}</span></div>
          <div className="text-sm space-y-1">
            <Row k="BTC trend" v={<span className={trendColor(mi.btcTrend)}>{mi.btcTrend}</span>} />
            <Row k="Risk verdict" v={<span className={mi.verdict === 'HIGH_RISK' ? 'badge-down' : mi.verdict === 'SAFE' ? 'badge-up' : 'text-warn'}>{mi.verdict}</span>} />
            <Row k="Funding" v={`${mi.fundingPct}%`} /><Row k="Whale proxy" v={mi.whaleProxy} />
            <ul className="text-muted text-xs mt-1 space-y-1">{mi.headlines.map((h, i) => <li key={i}>• {h}</li>)}</ul>
            <p className="text-muted text-[10px] mt-1 italic">{mi.note} Real-time headline feed integration is on the roadmap.</p>
          </div>
        </div>
      </section>
    </>
  );
}

function trendColor(t: string) { return t === 'bullish' ? 'badge-up' : t === 'bearish' ? 'badge-down' : 'text-warn'; }
function ago(iso: string): string {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Small UI pieces ──────────────────────────────────────────────────────────
function Card({ label, value, signed }: { label: string; value?: string; signed?: boolean }) {
  const neg = signed && value?.includes('-');
  return <div className="card"><p className="label">{label}</p><p className={`stat ${signed ? (neg ? 'badge-down' : 'badge-up') : ''}`}>{value ?? '…'}</p></div>;
}

/**
 * Portfolio Value as LIVE equity = Binance wallet balance + live unrealized P&L,
 * ticking per-second from the price feed — so it actually moves while a trade is
 * open (the raw wallet balance only changes when a trade closes).
 */
function LivePortfolioCard({ account, positions }: { account?: Account; positions: Position[] }) {
  const prices = useLivePrices(positions.map((p) => p.symbol));
  const base = account?.totalBalance ?? 0;
  const unreal = positions.reduce((s, p) => {
    const long = p.side === 'LONG';
    const entry = num(p.entryPrice);
    const mark = prices[p.symbol] ?? num(p.markPrice);
    return s + (long ? mark - entry : entry - mark) * num(p.quantity);
  }, 0);
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="label">Portfolio Value</p>
        {positions.length > 0 && <span className="text-[10px] badge-up animate-pulse">● live</span>}
      </div>
      <p className="stat">{account ? fmt(base + unreal) : '…'}</p>
      {positions.length > 0 && (
        <p className={`text-xs ${unreal >= 0 ? 'text-accent' : 'text-danger'}`}>{unreal >= 0 ? '+' : ''}{unreal.toFixed(2)} unrealized</p>
      )}
    </div>
  );
}
/** Sum of open positions' unrealized P&L using the live price feed. */
function liveUnreal(positions: Position[], prices: Record<string, number>): number {
  return positions.reduce((s, p) => {
    const long = p.side === 'LONG';
    const entry = num(p.entryPrice);
    const mark = prices[p.symbol] ?? num(p.markPrice);
    return s + (long ? mark - entry : entry - mark) * num(p.quantity);
  }, 0);
}
/** Unrealized P&L — ticks live from the 1s price feed. */
function LiveUnrealizedCard({ account, positions }: { account?: Account; positions: Position[] }) {
  const prices = useLivePrices(positions.map((p) => p.symbol));
  const v = positions.length ? liveUnreal(positions, prices) : num(account?.unrealizedPnl);
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="label">Unrealized P&L</p>
        {positions.length > 0 && <span className="text-[10px] badge-up animate-pulse">● live</span>}
      </div>
      <p className={`stat ${v >= 0 ? 'badge-up' : 'badge-down'}`}>{account ? fmt(v) : '…'}</p>
    </div>
  );
}
/** Today P&L — today's closed realized + live unrealized of open positions, so it ticks live. */
function LiveTodayCard({ todayRealized, positions }: { todayRealized: number; positions: Position[] }) {
  const prices = useLivePrices(positions.map((p) => p.symbol));
  const unreal = liveUnreal(positions, prices);
  const total = todayRealized + unreal;
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="label">Today P&L</p>
        {positions.length > 0 && <span className="text-[10px] badge-up animate-pulse">● live</span>}
      </div>
      <p className={`stat ${total >= 0 ? 'badge-up' : 'badge-down'}`}>{fmt(total)}</p>
      {positions.length > 0 && (
        <p className="text-muted text-[11px] mt-0.5">{fmt(todayRealized)} closed · {unreal >= 0 ? '+' : ''}{unreal.toFixed(2)} open</p>
      )}
    </div>
  );
}
function MiniStat({ label, value, sub, signed }: { label: string; value: string; sub?: string; signed?: boolean }) {
  const neg = signed && value.includes('-');
  return (
    <div className="bg-bg rounded p-2 border border-border">
      <p className="label">{label}</p>
      <p className={`font-bold ${signed ? (neg ? 'badge-down' : 'badge-up') : 'text-fg'}`}>{value}</p>
      {sub && <p className="text-muted text-xs">{sub}</p>}
    </div>
  );
}
function InfoCard({ icon, tone, text }: { icon: string; tone: InfoTone; text: string }) {
  const border = tone === 'good' ? 'border-accent/40' : tone === 'warn' ? 'border-warn/40' : tone === 'blue' ? 'border-sky-700/40' : 'border-border';
  return <div className={`card ${border}`}><p className="text-sm"><span className="mr-1">{icon}</span>{text}</p></div>;
}
function TradeReasonCard({ t }: { t: TradeReason }) {
  const gross = num(t.grossPnl);         // price-move P&L (before fees)
  const funding = num(t.funding);        // actual funding (±), 0 if none
  const qty = num(t.quantity);
  const entry = num(t.entryPrice);
  const exit = num(t.exitPrice);
  const entryVal = entry * qty;          // notional in at entry
  const exitVal = exit * qty;            // notional out at exit
  const margin = t.leverage ? entryVal / t.leverage : 0;
  // Actual Binance fee (matched from income) if available; else the round-trip taker
  // estimate. Always shown as a negative deduction and folded into Actual P&L.
  const fee = num(t.realFee) !== 0 ? num(t.realFee) : -(entryVal + exitVal) * TAKER_FEE_RATE;
  const actual = gross + fee + funding;  // true after-fee P&L
  const dur = t.durationSec == null ? '—'
    : t.durationSec >= 3600 ? `${(t.durationSec / 3600).toFixed(1)}h` : `${Math.round(t.durationSec / 60)}m`;
  return (
    <div className="card">
      <p className="font-bold flex items-center gap-2">
        {t.symbol} <span className={t.side === 'LONG' ? 'badge-up' : 'badge-down'}>{t.side}</span>
        <span className="text-xs text-muted">{t.leverage}×</span>
        <span className={`ml-auto ${actual >= 0 ? 'badge-up' : 'badge-down'}`}>{actual >= 0 ? '+' : ''}${actual.toFixed(3)}</span>
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs mt-2">
        <span className="text-muted">Entry price</span><span className="text-right">{entry.toFixed(4)}</span>
        <span className="text-muted">Exit price</span><span className="text-right">{exit.toFixed(4)}</span>
        <span className="text-muted">Entry value</span><span className="text-right">${entryVal.toFixed(2)}</span>
        <span className="text-muted">Exit value</span><span className="text-right">${exitVal.toFixed(2)}</span>
        <span className="text-muted">Qty · Margin</span><span className="text-right">{qty} · ${margin.toFixed(2)}</span>
        <span className="text-muted">P&L (price)</span><span className={`text-right ${gross >= 0 ? 'text-accent' : 'text-danger'}`}>{gross >= 0 ? '+' : ''}${gross.toFixed(3)}</span>
        <span className="text-muted">Binance fee</span><span className="text-right text-danger">-${Math.abs(fee).toFixed(3)}</span>
        {funding !== 0 && (<><span className="text-muted">Funding</span><span className={`text-right ${funding >= 0 ? 'text-accent' : 'text-danger'}`}>{funding >= 0 ? '+' : ''}${funding.toFixed(3)}</span></>)}
        <span className="text-muted font-bold">Actual P&L</span><span className={`text-right font-bold ${actual >= 0 ? 'badge-up' : 'badge-down'}`}>{actual >= 0 ? '+' : ''}${actual.toFixed(3)}</span>
      </div>
      <p className="text-xs text-muted mt-1.5 border-t border-border/70 pt-1.5">
        {t.exitReason} · {dur}{t.rr ? ` · R:R ${num(t.rr).toFixed(1)}` : ''} · {new Date(t.closedAt).toLocaleTimeString()}
      </p>
      <p className="text-xs mt-1">{t.reason}</p>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span>{v}</span></div>;
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="text-muted text-sm py-6 text-center">{children}</p>; }

/** 😱 Fear & Greed card — big alt.me number (drives the bot) + CoinMarketCap for
 *  reference + history sparkline + regime recommendation. Shown up top next to the
 *  Next Trade Preview. `fg` comes from the /intelligence payload. */
function FearGreedCard({ fg, tc }: { fg?: Intel['fearGreed']; tc: ReturnType<typeof themeColors> }) {
  if (!fg) return <div className="card"><p className="label mb-2">😱 Fear &amp; Greed</p><Empty>Loading…</Empty></div>;
  const fgCls = fg.value <= 25 ? 'badge-down' : fg.value <= 45 ? 'text-warn' : fg.value <= 55 ? 'text-muted' : fg.value <= 75 ? 'text-warn' : 'badge-down';
  return (
    <div className="card">
      <p className="label mb-2">😱 Fear &amp; Greed</p>
      <div className="text-center">
        <p className={`text-4xl font-bold ${fgCls}`}>{fg.value}</p>
        <p className={`text-sm ${fgCls}`}>{fg.label}</p>
        <p className="text-muted text-[11px] mt-0.5">alternative.me · drives the bot</p>
        {fg.cmc && (
          <p className="text-muted text-xs mt-1">CoinMarketCap: <span className="font-semibold">{fg.cmc.value}</span> · {fg.cmc.label}</p>
        )}
      </div>
      {fg.history.length > 1 && (
        <ResponsiveContainer width="100%" height={56}>
          <LineChart data={fg.history}><XAxis dataKey="date" hide /><YAxis hide domain={[0, 100]} />
            <Tooltip contentStyle={tip(tc)} />
            <Line type="monotone" dataKey="value" stroke={tc.accent} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="text-muted text-xs mt-1">{fg.recommendation}</p>
    </div>
  );
}

/** Plain-English meaning of each CRITICAL safety gate, so the hover detail says
 *  exactly WHAT is blocking — not just the gate's terse name. */
function gateHelp(label: string): string {
  if (label.includes('HIGH_RISK')) return 'Market is HIGH_RISK (extreme Fear & Greed, or high BTC volatility) — the bot stands aside until it calms.';
  if (label.includes('alt-long')) return 'BTC is bearish, so every LONG alt setup is blocked — only shorts can fire.';
  if (label.includes('alt-short')) return 'BTC is bullish, so every SHORT alt setup is blocked — only longs can fire.';
  if (label.startsWith('ADX')) return 'ADX is below the trend threshold — the market is chopping sideways, not trending.';
  if (label.startsWith('Spread')) return 'The bid/ask spread is too wide right now — an entry would lose too much to slippage.';
  if (label.startsWith('Funding')) return 'Funding rate is too high — positioning is crowded; the bot avoids paying it.';
  return '';
}

/** Wraps a READY/GATED status and reveals, on hover/focus, the COMPLETE reason a
 *  trade is (or isn't) held: bot state, hard critical blocks, the score gap, and
 *  every weighted check dragging the score down. */
function GateDetail({ s, botStatus, children }: { s: SignalRow; botStatus?: string; children: React.ReactNode }) {
  const crit = s.criticalFails ?? [];
  const weak = s.weakConditions ?? [];
  const gap = s.threshold - s.score;
  const notRunning = !!botStatus && botStatus !== 'RUNNING';
  return (
    <span className="relative inline-block group align-middle" tabIndex={0}>
      <span className="cursor-help underline decoration-dotted underline-offset-2">{children}</span>
      <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100
                      transition-opacity absolute right-0 z-50 mt-1 w-72 max-w-[18rem] rounded-lg border border-border bg-surface
                      shadow-card p-3 text-left text-xs leading-snug font-normal text-fg whitespace-normal space-y-2">
        <p className="font-semibold">{s.allPass ? '✅ Why this would trade' : '🚫 Why this trade is held'}</p>

        {notRunning && (
          <p className="text-warn">⏸ Bot is {botStatus!.toLowerCase()} — signals are computed but no order fires until you press Start.</p>
        )}

        {s.allPass ? (
          <p className="text-muted">All safety gates pass and the score clears the bar. It opens on the next 60-second tick (margin &amp; daily-cap permitting).</p>
        ) : (
          <>
            {s.bias === 'none' && (
              <p>• <b>No direction</b> — price sits between VWAP and EMA8, so neither a long nor a short qualifies yet.</p>
            )}

            {crit.length > 0 && (
              <div>
                <p className="text-danger font-medium">Hard blocks — any one stops the trade:</p>
                <ul className="mt-1 space-y-1">
                  {crit.map((c) => (
                    <li key={c}>✗ <b>{c}</b>{gateHelp(c) && <span className="text-muted"> — {gateHelp(c)}</span>}</li>
                  ))}
                </ul>
              </div>
            )}

            <p>
              <b>Score {s.score}/{s.threshold}</b>{' '}
              {gap > 0 ? <span className="text-warn">— {gap} below the quality bar</span> : <span className="text-accent">— clears the bar</span>}
              {typeof s.earnedWeight === 'number' && typeof s.totalWeight === 'number' && s.totalWeight > 0 && (
                <span className="text-muted"> ({s.earnedWeight}/{s.totalWeight} pts)</span>
              )}
            </p>

            {weak.length > 0 && (
              <div>
                <p className="text-muted font-medium">Weighing the score down:</p>
                <ul className="mt-1 space-y-0.5">
                  {weak.slice(0, 7).map((w) => (
                    <li key={w.label}>✗ {w.label} <span className="text-muted">(−{w.weight})</span></li>
                  ))}
                  {weak.length > 7 && <li className="text-muted">+{weak.length - 7} more…</li>}
                </ul>
              </div>
            )}

            {crit.length === 0 && weak.length === 0 && s.bias !== 'none' && (
              <p className="text-muted">{s.blocking}</p>
            )}
          </>
        )}
      </div>
    </span>
  );
}
function fmt(n?: number) { return n == null ? '…' : `$${n.toFixed(2)}`; }

/**
 * "What is this bot?" — a plain-English explainer for new users. Collapsible so
 * it stays out of the way once you know how it works. Purely informational.
 */
function BotExplainer({ bot }: { bot?: BotCfg }) {
  const learning = bot?.useAdaptiveLearning;
  const points: { icon: string; title: string; body: string }[] = [
    { icon: '🤖', title: 'What it is',
      body: 'An automated trading assistant for your own Binance USDT-M Futures account. Every ~60 seconds it checks your watchlist and trades only high-quality setups for you — using your own encrypted API keys, fully isolated from other users.' },
    { icon: '🧮', title: 'Bot type & model',
      body: 'A deterministic, RULE-BASED algorithmic bot — not a chatbot or black-box AI. It runs server-side as one isolated instance per user, ticking every ~60s. The “model” is a transparent technical-analysis scoring engine (EMA/VWAP trend, RSI pullback, MACD, ADX, ATR, volume, multi-timeframe agreement, market structure) that grades each coin 0–100 and applies hard safety gates. No LLM or neural network places trades — so every decision is explainable and repeatable, and the “AI” features (strategy selector, trade plan, news read) are rule-based heuristics, not generated text.' },
    { icon: '🎯', title: 'How it picks a trade',
      body: 'It scores each coin 0–100 on a 19-point checklist (trend, EMA alignment, RSI pullback, MACD, volume, ADX, multi-timeframe agreement, market structure, patterns…). A trade opens only when there is a clear direction, the score is ≥ your threshold, AND every safety gate passes.' },
    { icon: '🛡️', title: 'Safety gates (all must pass)',
      body: 'Spread not too wide · market not HIGH_RISK · funding not extreme · BTC trend aligned with the trade · ADX shows a real trend (not chop). If any fails, the bot stands aside — no trade.' },
    { icon: '🧠', title: 'AI strategy selector',
      body: 'It reads the live market “regime” (trending / ranging / volatile / weak) and picks the strategy family best suited to it, with a confidence % and a reason. It is deterministic and explainable — not a black-box.' },
    { icon: '📉', title: 'It protects every trade',
      body: 'Automatic stop-loss, take-profit, break-even and a trailing profit-lock ladder (the stop ratchets up as profit grows, never back; closes at +5%). Enforced in software so it works even on basic API keys.' },
    { icon: learning ? '🧪' : '⚙️', title: learning ? 'Adaptive learning: ON' : 'Rule-based (learning off)',
      body: learning
        ? 'Adaptive learning is enabled: the bot raises the quality bar for coins that have lost for you (or pauses them), and slightly relaxes it for coins with a proven win record — learning from YOUR closed-trade history. It never changes leverage, size, or the safety gates.'
        : 'By default the rules are fixed — the bot does not learn from past trades. Turn on “Adaptive learning” in Bot Settings to let it tune the quality bar per coin from your own results.' },
  ];
  return (
    <details className="card group">
      <summary className="cursor-pointer flex items-center justify-between list-none">
        <span className="label">ℹ️ What is this bot &amp; how does it work?</span>
        <span className="text-muted text-xs group-open:hidden">▼ show</span>
        <span className="text-muted text-xs hidden group-open:inline">▲ hide</span>
      </summary>
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        {points.map((p, i) => (
          <div key={i} className="bg-bg rounded p-3 border border-border">
            <p className="text-sm font-bold text-fg"><span className="mr-1">{p.icon}</span>{p.title}</p>
            <p className="text-muted text-xs mt-1 leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
      <p className="text-muted text-[11px] mt-3 italic">
        Tip: new accounts start in <b>Paper</b> mode — the bot simulates trades on live prices with no real orders, so you can watch it work risk-free before going live.
      </p>
    </details>
  );
}

/**
 * 🧪 Adaptive Learning — shows what the opt-in learning is doing per coin: how the
 * score bar has been raised/lowered (or the coin paused) based on the user's own
 * closed-trade record. Only fetches when learning is enabled.
 */
function AdaptiveLearningCard({ enabled }: { enabled?: boolean }) {
  const [d, setD] = useState<LearningOverview>();
  useEffect(() => {
    if (!enabled) { setD(undefined); return; }
    let alive = true;
    const load = () => api.get<LearningOverview>('/api/bot/learning').then((x) => { if (alive) setD(x); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="label">🧪 Adaptive Learning {enabled ? <span className="badge-up text-xs">ON</span> : <span className="text-muted text-xs">off</span>}</p>
        {d && <span className="text-muted text-xs">base bar {d.baseThreshold} · {d.coinsLearned} coin(s) learned · ↑{d.raised} pickier · ↓{d.lowered} looser · ⏸ {d.blocked} paused · ↻ 60s</span>}
      </div>
      {!enabled ? (
        <Empty>Off. Turn on <b>🧪 Adaptive learning</b> in Bot Settings below to let the bot tune the quality bar per coin from your own results (it only ever makes the bot more selective — never riskier).</Empty>
      ) : !d || d.coins.length === 0 ? (
        <Empty>Learning is on. It needs at least {d?.minSamples ?? 5} closed trades on a coin before it adjusts that coin&apos;s bar — keep trading (Paper is fine) and adjustments will appear here.</Empty>
      ) : (
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-muted text-xs"><th className="text-left">Coin</th><th>Trades</th><th>Win%</th><th>Net P&L</th><th>Score bar</th><th className="text-left pl-3">What learning did</th></tr></thead>
          <tbody>{d.coins.map((c) => (
            <tr key={c.symbol} className="border-t border-border align-top">
              <td className="font-bold">{c.symbol}</td>
              <td className="text-center">{c.trades}</td>
              <td className="text-center">{c.winRate}%</td>
              <td className={`text-center ${c.netPnl >= 0 ? 'badge-up' : 'badge-down'}`}>{c.netPnl >= 0 ? '+' : ''}{c.netPnl.toFixed(2)}</td>
              <td className="text-center">
                {c.blocked ? <span className="badge-down text-xs">⏸ PAUSED</span>
                  : <b className={(c.delta ?? 0) > 0 ? 'text-warn' : (c.delta ?? 0) < 0 ? 'text-accent' : ''}>{c.threshold}{c.delta ? ` (${c.delta > 0 ? '+' : ''}${c.delta})` : ''}</b>}
              </td>
              <td className="text-left pl-3 text-xs text-muted">{c.note}</td>
            </tr>))}</tbody>
        </table>
      )}
    </section>
  );
}

// Bot settings now live exclusively in Profile → Setup (the duplicate dashboard
// editor + its Num helper were removed to avoid two places to change config).

function TradeDetailModal({ symbol, trips, onClose }: { symbol: string; trips: Trip[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div className="card max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-accent font-bold">{symbol} — trade detail ({trips.length})</p>
          <button className="btn-danger text-xs" onClick={onClose}>✕ Close</button>
        </div>
        {trips.length === 0 ? <Empty>No round-trips</Empty> : trips.map((t) => (
          <div key={t.id} className="border-t border-border py-2 text-sm">
            <p>
              <span className={t.side === 'LONG' ? 'badge-up' : 'badge-down'}>{t.side}</span>{' '}
              {t.entry} → {t.exit} ·{' '}
              <span className={t.netPnl >= 0 ? 'badge-up' : 'badge-down'}>{t.netPnl >= 0 ? '+' : ''}{t.netPnl.toFixed(4)}</span>{' '}
              <span className="text-muted text-xs">{t.exitReason} · {t.durationSec ? `${Math.round(t.durationSec / 60)}m` : ''}</span>
            </p>
            <p className="text-muted text-xs">{t.analysis} · {new Date(t.closedAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Usage meter — exactly where the user stands with their plan. */
function UsageMeter({ u, onSubscribe }: { u: Usage; onSubscribe: (plan: 'BASIC' | 'PRO') => void }) {
  if (u.unlimited) {
    return (
      <section className="card flex items-center justify-between">
        <div><p className="label">Usage &amp; Billing · Admin</p><p className="stat">Unlimited · Free</p></div>
        <p className="text-muted text-sm">Admin accounts have full access. Trades this month: {u.tradesUsed}</p>
      </section>
    );
  }
  const unlimited = !!u.unlimitedTrades;
  const pct = unlimited ? 100 : Math.min(100, Math.round((u.tradesUsed / Math.max(1, u.includedTrades)) * 100));
  const date = (dt: string | null) => (dt ? new Date(dt).toLocaleDateString() : '—');
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="label">Usage &amp; Billing · {u.plan} {u.inTrial && '(Free Trial)'}</p>
        <span className={`text-sm font-bold ${u.status === 'EXPIRED' || u.status === 'PAST_DUE' ? 'text-warn' : 'text-accent'}`}>{u.status}</span>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted">Trades This Month</span>
          <span className="text-fg">{u.tradesUsed}{unlimited ? ' · Unlimited' : `/${u.includedTrades}`}</span>
        </div>
        {!unlimited && <div className="h-2 bg-bg rounded overflow-hidden border border-border"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Meter label="Trades" value={unlimited ? 'Unlimited' : `${u.remainingIncludedTrades} left`} />
        <Meter label={u.inTrial ? 'Est. Invoice' : 'Est. Next Invoice'} value={u.inTrial ? 'Free (trial)' : `$${u.estimatedInvoiceUsd.toFixed(2)}`} />
        <Meter label={u.inTrial ? 'Trial Ends' : 'Renews'} value={date(u.inTrial ? u.trialEndsAt : (u.renewalDate ?? u.nextBillingDate))} />
        <Meter label="Plan" value={u.billingInterval === 'YEAR' ? `$${(u.planPriceUsd ?? 0).toFixed(0)}/yr` : `$${u.monthlyPriceUsd.toFixed(2)}/mo`} />
      </div>
      {(u.inTrial || u.viewOnly) && (
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => onSubscribe('BASIC')}>{u.viewOnly ? 'Subscribe' : 'Upgrade'} · Basic ${centsToUsd(BILLING.basicMonthlyCents)}/mo</button>
          <button className="btn" onClick={() => onSubscribe('PRO')}>Go Pro ${centsToUsd(BILLING.proAnnualCents)}/yr · {BILLING.proMonthsFree} mo free</button>
        </div>
      )}
    </section>
  );
}
function Meter({ label, value }: { label: string; value: string }) {
  return <div className="bg-bg rounded p-2 border border-border"><p className="label">{label}</p><p className="text-fg font-bold">{value}</p></div>;
}
