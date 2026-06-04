# Feature Parity Matrix — claude-execute ➜ SaaS Platform

> **Promise:** every feature in your personal `claude-execute` bot is carried over into the
> multi-tenant SaaS. Nothing is dropped. The only change is *isolation*: where the single-user bot
> used **one** Binance key and **one** account, the SaaS gives **every client their own encrypted
> keys, their own bot instance, their own positions, and profit on their own Binance account.**

Legend: ✅ ported in Phase 1 · 🟡 scaffolded (contract + stub, fill-in next) · 🔭 designed for a later phase

---

## A. Trading strategy & signals (the brain)

| claude-execute feature | SaaS location | Multi-tenant change | State |
|---|---|---|---|
| 19-condition scoring (15 weighted = 100 + 4–5 critical gates) | `backend/src/modules/bot/strategy.ts` → `runSafetyCheck()` | `scoreThreshold` + filter toggles come from each user's `BotConfig` | ✅ |
| Bias detection (VWAP/EMA/RSI) | `strategy.ts`, `indicators.ts` | per-user, per-symbol | ✅ |
| Indicators: EMA 8/20/50/200, EMA slope, VWAP, RSI(3), MACD, ATR, ADX, volume | `bot/indicators.ts` | identical math, ported 1:1 | ✅ |
| Candle patterns (engulfing/hammer/star) | `indicators.ts` → `detectCandlePattern` | — | ✅ |
| Swing S/R, market structure (HH-HL / LH-LL) | `indicators.ts` → `findSwingLevels`, `detectMarketStructure` | — | ✅ |
| Liquidity sweep, S/R breakout detection | `strategy.ts` ctx (`sweep`, `breakout`) | wired into scoring | 🟡 (ctx slots present; detectors stubbed) |
| Multi-TF agreement (5m/15m/1h) | `bot/engine.ts` → `evaluateSymbol` | per-user watchlist | ✅ |
| Critical gates: spread, market verdict, BTC trend (alt-long/short), funding, ADX>20 | `strategy.ts` | — | ✅ |
| Fear & Greed contrarian condition | `strategy.ts` ctx + `market-status` module | shared market data (1 fetch, all tenants) | 🟡 |

## B. Execution & risk management (defence in depth)

| claude-execute feature | SaaS location | Multi-tenant change | State |
|---|---|---|---|
| Per-tenant order placement (market entry) | `binance/binance.client.ts` + `engine.ts` → `openPosition` | client bound to user's keys | ✅ |
| Position sizing (USD notional → coin qty) | `engine.ts` → `openPosition` | per-user `marginPerTradeUsd`/`leverage` | ✅ |
| Balance-aware ladder / fixed sizing toggle | `engine.ts` + `BotConfig.dynamicSizing` | per-user; default fixed (your preference) | 🟡 |
| 50% margin guard | `engine.ts` → `tickUser` | per-user `marginGuardPct` | ✅ |
| Concurrency cap (multi-coin) | `engine.ts` | per-user `maxConcurrentPositions` | ✅ |
| Daily trade cap | `engine.ts` + `manager.resetDailyCounters` | per-user `maxTradesPerDay` | ✅ |
| Per-symbol loss cooldown | `engine.ts` (cooldown check) | per-user `lossCooldownMin` | 🟡 |
| Consecutive-loss auto-pause | `engine.ts` → `pauseWithError` | per-user `maxConsecutiveLosses` | ✅ |
| Leverage-bracket capping | `binance.client.ts` → `setLeverage` (+ bracket lookup) | per-user | 🟡 |
| Software watchdog: break-even, trailing, hard SL/TP, reduceOnly close | `engine.ts` → `runWatchdog` | runs for every tenant's positions independently | ✅ |
| -4120 (no Algo-Order) handling → software stops | watchdog (same as original) | — | ✅ |
| -1003 rate-limit circuit breaker + ban persistence | `binance.client.ts` → `isBanned`/`recordBanFromMsg` | shared per worker IP | ✅ |
| TTL cache (klines 3s, funding 60s) | `binance.client.ts` → `cached()` | shared | ✅ |
| Orphan-position protection / reconciliation | `engine.ts` → watchdog `EXTERNAL` close | per-user | ✅ |
| Real-time WebSocket engine (bot-live.js, ~1m latency) | `bot/manager.ts` 60s sweep + per-user WS klines | becomes the multi-tenant scheduler | ✅ (REST sweep) / 🔭 (per-symbol WS streams) |

## C. Dashboard & monitoring (every panel)

| claude-execute feature | SaaS location | State |
|---|---|---|
| Account summary (portfolio value, wallet, margin) | `trading` module `/api/account` + frontend card | 🟡 |
| Open positions table | `trading` module `/api/positions` | 🟡 |
| Live signals table (BOT score/bias/gates, 🚫 BLOCKED rows) | `bot/engine` decisions → `/api/signals` + realtime | 🟡 |
| Today's trades + per-symbol P&L | `trading` `/api/trades`, `/api/pnl` | 🟡 |
| Equity curve | `PnlHistory` → `/api/pnl/history` | 🟡 |
| Market status (BTC trend, verdict, funding, F&G) | `market` module `/api/market-status` (shared) | 🟡 |
| Bot Mode whole-dashboard sync (LIVE 60s / NORMAL 180s) | frontend refresh hook + `BotConfig` | 🟡 |
| Win rate / ROI / risk score | `trading` analytics + frontend | 🟡 |
| Next trade preview | `/api/signals` top candidate | 🟡 |
| Bot activity log | `/api/bot/log` (notifications) | ✅ |
| Real-time updates (positions, pnl, signals, logs) | `notifications/realtime.ts` (WS, per-user channels) | ✅ |

## D. Analysis pages (the deep-dive features)

| claude-execute feature | SaaS location | State |
|---|---|---|
| Trader Performance Analysis (per-coin table) | `trading/performance.service.ts` `/api/trader-performance` | 🟡 |
| Trade detail modal (round-trips, durations, R:R, IST timeline) | `/api/trade-detail?symbol=` → `reconstructRoundTrips()` | 🟡 |
| Rule-based AI trade analysis (why won/lost) | `performance.service.ts` → `tripAiAnalysis()` | 🟡 |
| News & Research block (sentiment/headlines/whale proxy, free signals) | `market/research.service.ts` | 🟡 |
| Chart Details page (TradingView Advanced Charts widget) | `frontend/app/(app)/chart/[symbol]` | 🟡 |
| 🤖 AI Trade Plan (optimal R:R from S/R+ATR+ADX+vol+BTC align) | `bot/analysis.service.ts` → `aiTradePlan()` | 🟡 |
| Multi-TF S/R (15m/1h/4h/1d pooled, TF-tagged) | `analysis.service.ts` → `multiTfSupportResistance()` | 🟡 |
| Coin switcher / per-coin chart | frontend chart page | 🟡 |
| Signal conditions / multi-TF / market structure cards | `/api/chart-detail?symbol=` | 🟡 |

## E. Notifications & records

| claude-execute feature | SaaS location | State |
|---|---|---|
| Telegram (entry/close/break-even/trailing/auto-pause) | `notifications/telegram.service.ts` | 🟡 (per-user bot token/chat in profile) |
| In-app notifications | `Notification` table + `/api/notifications` | ✅ |
| Email (verification, password reset, alerts) | `notifications/email.service.ts` | 🟡 |
| Tax-ready trade ledger (trades.csv) | `TradeHistory` table + `/api/export/trades.csv` | 🟡 |
| Tax summary | `trading/tax.service.ts` | 🟡 |

## F. Control & ops

| claude-execute feature | SaaS location | State |
|---|---|---|
| Pause/resume (one click) | `/api/bot/pause`, `/api/bot/start` | ✅ |
| Editable config with live preview | `/api/bot/config` (PATCH) + frontend form | ✅ (api) / 🟡 (ui) |
| Trading mode presets | `/api/bot/mode` (Conservative/Balanced/Aggressive) | ✅ |
| Onboarding (connect key → mode → activate) | `frontend/app/(app)/onboarding` + `/api/apikeys` | ✅ (api) / 🟡 (ui) |
| Region-pin / 451 handling (deploy concern) | spot-host market data + `docs/05-deployment-guide.md` | ✅ |
| Probe reachability | reused `probe.js` pattern in deploy guide | ✅ (doc) |

---

## What's genuinely NEW in the SaaS (not in claude-execute)

These exist because it's now a product for many clients, not one trader:

- **Per-user Binance key vault** (AES-256-GCM) — `apikeys` module.
- **Multi-tenant isolation** — every query scoped by `userId` from the JWT; users physically cannot read each other's data.
- **Auth**: registration, JWT + refresh rotation, 2FA, sessions/devices — `auth` module.
- **Revenue engine**: **subscription billing** — $10/mo Basic incl. 150 trades, $0.10/overage, 30-day trial (one per email/mobile/Binance-UID), view-only on expiry, monthly usage invoices + dashboard usage meter — `fees` module (`billing.service.ts`). *(The earlier 1% profit-share was removed.)*
- **Admin CRM**: users, revenue, force-close, broadcast, audit — `admin` module.
- **RBAC**: Admin / Manager / Support / Trader — `middleware/rbac.ts`.
- **Bot orchestrator**: one loop ticks all running tenants with per-user locks — `bot/manager.ts`.

> Bottom line: **your single-account bot becomes one tenant among many.** The decision logic that
> made it work is byte-for-byte the same engine; the platform wraps it in isolation, accounts,
> billing, and an admin console.
