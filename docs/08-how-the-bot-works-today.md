# 08 — How the bot works TODAY (complete end-to-end)

> This documents the **current, live system** exactly as it runs — the deterministic
> rule engine, the per-user tick loop, trade protection, the risk controls, and the
> **auto-learning** question (does it learn or not?). For the *future* ML/LLM plan, see
> [`07-ai-ml-llm-roadmap.md`](./07-ai-ml-llm-roadmap.md).
>
> TL;DR: it's a **deterministic, rule-based algorithmic bot** — **no LLM, no ML model**.
> It **does not auto-learn by default**; an **opt-in** "adaptive learning" toggle adds a
> light *statistical* self-tuning of the per-coin quality bar (never a trained model).

---

## 1. What it is (one paragraph)

A **multi-tenant SaaS trading bot** for **Binance USDT-M Futures**. Each user gets one
**isolated** bot instance that trades **their own** account via **their own encrypted API
keys** — no user can read or move another's funds. Every ~60 seconds the bot scores each
coin on the user's watchlist with a fixed technical-analysis rulebook and opens a trade
**only** when there's a clear direction, a high enough score, **and** every hard safety
gate passes. It is fully **deterministic and explainable**: same inputs → same output,
with no LLM and no machine-learning model anywhere in the decision path.

---

## 2. The scheduler — how ticks happen (`bot/manager.ts`)

```
botManager.start()  →  setInterval(sweep, 60_000)   // one sweep per minute
sweep():
  • skip if a Binance ban is active (isBanned)
  • load every bot with status RUNNING or PAUSED
  • fan out, 10 users in parallel (CONCURRENCY)
  • per user: acquire Redis lock bot:lock:<userId> (55s TTL) → tickUser → release
```

- **RUNNING** bots trade **and** are watchdogged. **PAUSED** bots are still ticked so the
  watchdog keeps protecting any open positions, but they open **no new** trades.
- The **per-user lock** makes ticks idempotent — safe to run multiple workers; one tick
  per user per minute. (Scaling path: shard by `userId`, or move to a job queue.)
- **Daily reset** (`resetDailyCounters`) runs each minute and, at **each user's local
  midnight**, zeroes `tradesToday` + the loss streak and auto-resumes a bot that was
  paused by the daily-cap or loss-streak protector (a manual Stop stays stopped).

---

## 3. One user's tick, end-to-end (`bot/engine.ts → tickUser`)

```
tickUser(userId):
 0. load BotConfig. If status ∉ {RUNNING, PAUSED} → idle.
    If PAUSED and no open positions → skip (nothing to protect).
 1. decrypt the user's Binance API key. Missing/invalid → pause with error, stop.
 2. SYNC: getBalance + getPositions (Binance). Save balance to TradingAccount.
    Run the WATCHDOG (protects open trades) — paper or live variant.
 3. Gate to RUNNING only. (A PAUSED bot stops here — it just protected its trades.)
 4. BILLING GATE: canTradeNow? If trial/subscription lapsed → VIEW-ONLY (no new
    trades, no signals; existing positions still protected).
 5. RISK PRE-CHECKS, in order:
       • consecutive losses ≥ max → auto-pause ("ERROR")
       • daily trade cap reached (maxTradesPerDay > 0) → pause until tomorrow
       • concurrency: open positions ≥ maxConcurrentPositions → stop opening
       • margin guard: used margin ≥ marginGuardPct (default 50%) → stop opening
 6. SCAN the default watchlist: for each symbol → evaluateSymbol() → {bias, score, allPass}
 7. RANK the passing setups by score (best first); open them one-by-one until
    open-slots / daily-cap / available-margin run out.
 8. Publish signals to the dashboard (realtime), set lastTickAt; if the daily cap was
    hit this tick → pause.
```

**Key point:** the watchdog (step 2) runs for **RUNNING and PAUSED** bots; new trades
(steps 4–8) run **only for RUNNING** bots that pass billing + risk gates.

---

## 4. How a coin is scored (`engine.ts → evaluateSymbol` + `bot/strategy.ts`)

```
evaluateSymbol(symbol):
  • klines 1m ×250  → price, EMA8, VWAP, RSI(3)
  • multi-timeframe bias: 5m / 15m / 1h  → how many agree with the base direction
  • funding rate
  • buildCandleCtx → the full ~24-condition professional suite (trend, EMA align,
    RSI pullback, MACD, ADX, ATR, volume, market structure, breakout, sweep, patterns…)
  • base direction = long if price > VWAP and > EMA8; short if below both; else none
  • runSafetyCheck(...) →
       score   = earnedWeight / totalWeight × 100   (normalised 0–100)
       allPass = has direction AND score ≥ threshold AND every CRITICAL gate passes
```

**The CRITICAL gates (any one failing = no trade, regardless of score):**
- `Spread ≤ 0.1%` — book not too wide
- `Market verdict ≠ HIGH_RISK` — stands aside in extreme-fear / high-volatility regimes
- `BTC aligned` — alt-longs blocked when BTC is bearish; alt-shorts blocked when bullish
- `Funding < 0.05%` — avoid crowded/expensive positioning
- `ADX > 20` — a real trend, not chop

**The threshold** is `BotConfig.scoreThreshold` (default 85; "Balanced") — **unless**
adaptive learning is on, in which case it's the per-coin `effectiveThreshold` (see §8).

> This is why "score 79 but no trade" happens: a critical gate (e.g. HIGH_RISK) vetoes
> it even above the bar. The dashboard's "why gated" hover surfaces exactly which gate.

---

## 5. Opening a trade (`engine.ts → openPosition`)

```
• R:R floor: reject if effective risk:reward < 1:3
• wallet pre-flight: need ≥ marginPerTradeUsd × 1.05 available (5% fee/slippage buffer)
• notional = marginPerTradeUsd × leverage   (reject if < $5 min-notional)
• size to the symbol's LOT_SIZE step; honour minQty / minNotional (avoid -1111)
• SL = entry ∓ slPercent% ; TP = slPercent × tpRR
• PAPER: no real order — create a simulated Position row
  LIVE : setLeverage → market order → attach server-side STOP_MARKET
         (if the key lacks "Futures Algo Orders" (-4120) → fall back to the software
          watchdog; warn the user once)
• persist Position, tradesToday += 1, record monthly usage, notify ("[PAPER]" tag if paper)
```

---

## 6. Protecting every open trade — the watchdog (every 60s)

Two variants, **same protection logic**:

- **LIVE (`runWatchdog`)** — hybrid:
  - *Primary:* the server-side `STOP_MARKET` closes the instant price crosses it (no 60s
    gap), and is **ratcheted up** as the profit ladder arms.
  - *Backup:* the software watchdog re-evaluates each tick and market-closes with
    `reduceOnly` if the exchange stop was rejected or hasn't filled; also self-heals
    orphaned stops and reconciles positions that left the exchange using Binance's
    realized PnL.
- **PAPER (`runPaperWatchdog`)** — identical break-even / trailing / SL-TP logic, but the
  mark price comes from public market data and closes are simulated (no real order).

**The protection ladder:**
- **Stop-loss** and **take-profit** (from entry).
- **Break-even** — once profit ≥ `trailArmPct%`, the stop moves to lock in gains.
- **Trailing profit-lock** — the stop then trails `trailGapPct%` behind the running
  profit, **ratchets up only** (never against the trade), and the runner is capped at
  **+5%** (`PROFIT_TAKE_CAP`).
- **Optional scaled-TP ladder** (`useScaledTp`, default off) — book partial TP1/TP2 and
  ride a runner with the stop at break-even.
- **P&L is net of fees**; win/loss (which drives the loss-streak protector) is decided on
  **net** P&L.

---

## 7. Risk & safety controls (the guardrails)

| Control | Default | Effect |
|---|---|---|
| `scoreThreshold` | 85 | quality bar a setup must clear |
| `maxConcurrentPositions` | 3 | max open trades at once |
| `maxTradesPerDay` | 6 (0 = unlimited, admin) | daily cap → pause when hit |
| `marginGuardPct` | 50% | stop opening if used margin ≥ this |
| `maxConsecutiveLosses` | 3 | auto-pause after a losing streak |
| `lossCooldownMin` | 30 | cool-off after a loss |
| `slPercent` / `tpRR` | — | stop distance / reward ratio (R:R floor 1:3) |
| mandatory SL | always | every entry is protected (exchange or software) |
| subscription gate | — | view-only when trial/sub lapses |
| daily reset | per user TZ | zero counters + auto-resume protective pauses |

Safety gates and these limits are **the final authority** — nothing overrides them.

---

## 8. Does it auto-learn? — **complete answer**

**By default: NO.** The rulebook is fixed; the bot does **not** learn from past trades,
and there is **no trained model, no neural net, no LLM** involved. Same market → same
decision, every time.

**Optionally: YES — but only a light, statistical self-tuning**, if the user turns on the
**`useAdaptiveLearning`** checkbox in Bot Settings (default **off**). What it actually does
(`bot/learning.service.ts`):

- **Learns only from the user's OWN closed trades** (`TradeHistory`), **per coin**.
- **Adjusts only one thing: the per-coin score threshold** (the quality bar) — via
  `effectiveThreshold(userId, base, symbol)`, which the engine calls instead of the flat
  `scoreThreshold`:
  - Coin losing / poor win-rate (with enough samples) → **raise** the bar (be pickier).
  - Coin clearly unprofitable → **pause** the coin entirely (sentinel `BLOCKED = 101`,
    which a 0–100 score can never reach).
  - Coin with a strong, proven win-rate → **lower** the bar slightly (bounded), to let a
    working setup through more often.
- **Conservative bounds:** needs **≥5** closed trades to adjust a coin, **≥8** to pause it;
  raise at most **+10**, lower at most **−5**; effective threshold floored at **60**,
  ceiled at **100**. Never relaxes the bar for a coin that's net-negative overall.
- **It never touches leverage, position size, or the critical safety gates** — so the
  *worst* it can ever do is make the bot trade **less**. It cannot make the bot riskier.
- Stats are cached per user for 5 min and **busted when a trade closes** so learning
  reflects the latest outcome. The dashboard's "🧪 Adaptive Learning" card shows, per
  coin, the win-rate, net P&L, the adjusted bar, and a plain-English note.

**So, precisely:**

| Question | Answer |
|---|---|
| Auto-learns by default? | **No** — fixed rules |
| Can it learn? | **Yes, opt-in** (`useAdaptiveLearning`) |
| Is "learning" a trained ML model / LLM? | **No** — a bounded statistical adjustment of the per-coin score bar from your own trade history |
| What can it change? | Only the **per-coin quality bar** (raise / lower / pause the coin) |
| Can it increase risk? | **No** — never touches size, leverage, or safety gates |
| A true self-training model? | **Not today** — that's the Phase-3 plan in [`07-ai-ml-llm-roadmap.md`](./07-ai-ml-llm-roadmap.md) |

---

## 9. Where "AI / Agent / LLM" fit in the CURRENT product

- **LLM:** **none.** `analysis.service.ts` literally comments *"No LLM"*, and there are
  **zero AI/ML dependencies** in the codebase. Nothing calls Anthropic/OpenAI/etc.
- **The "AI" features are rule-based heuristics**, not generated text:
  - **AI strategy selector** — reads the market regime (trend/range/volatile/weak) and
    deterministically picks a strategy family with a confidence % and reason.
  - **AI trade plan / news & research / F&G recommendation** — computed from free market
    signals (indicators, funding, Fear & Greed), not an LLM.
- **"Agent"** here = the per-user **scheduled tick loop** (a deterministic software agent),
  **not** an LLM agent.
- **Claude / Claude Code** is only a **development tool** used to build and maintain the
  project. It is **not** part of the running product — if that subscription lapses, the
  live platform is **unaffected** (no runtime dependency). The only "Claude" string in the
  app is the **2FA issuer label** (`ClaudeTrading`).

---

## 10. End-to-end data flow (one picture)

```
        Binance Futures API            Fear&Greed (alt.me)        CoinMarketCap (display)
   (klines · funding · account)              │                            │
            │                                 ▼                            ▼
            │                         ┌──────────────────────────────────────────────┐
            │                         │ market.service: regime / verdict / F&G        │
            │                         │   computed ONCE, cached 60s, shared by all     │
            │                         └───────────────┬──────────────────────────────┘
            ▼                                          │ shared context
   ┌──────────────────────────  per user, every 60s (manager → tickUser)  ──────────────┐
   │ sync balance/positions → WATCHDOG (SL/TP/break-even/trailing, paper or live)        │
   │ billing gate → risk gates → for each watchlist coin: evaluateSymbol (24 conditions) │
   │   → score 0–100 + critical gates → (adaptive? per-coin bar) → allPass?              │
   │   → rank → openPosition (paper = simulated · live = market order + STOP_MARKET)     │
   │   → persist Position / TradeHistory · usage meter · realtime publish · notify       │
   └───────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ realtime (WS) + REST (cached)
                                            ▼
                       Next.js dashboard: KPIs · Top Opportunity · Next Trade
                       (why-gated hover) · Live Signals · Protection · Adaptive Learning
```

---

## 11. Component / file map

| Concern | File |
|---|---|
| Scheduler / sweep / per-user lock / daily reset | `backend/src/modules/bot/manager.ts` |
| Per-user tick, scoring call, open trade, watchdogs | `backend/src/modules/bot/engine.ts` |
| The rulebook: conditions, score, **critical gates** | `backend/src/modules/bot/strategy.ts`, `strategy-context.ts` |
| Indicators (EMA/VWAP/RSI/ATR/ADX/MACD…) | `backend/src/modules/bot/indicators.ts` |
| **Adaptive learning** (per-coin bar) | `backend/src/modules/bot/learning.service.ts` |
| Shared market regime / F&G (cached) | `backend/src/modules/binance/market.service.ts` |
| Binance client (orders, klines, balances, stops) | `backend/src/modules/binance/binance.client.ts` |
| Rule-based "AI" features (selector / plan / news) | `backend/src/modules/bot/analysis.service.ts`, `strategy-selector.service.ts` |
| Billing / view-only gate | `backend/src/modules/fees/billing.service.ts` |
| Dashboard UI | `frontend/app/(app)/dashboard/page.tsx` |
| Data model (BotConfig, Position, TradeHistory…) | `backend/prisma/schema.prisma` |

---

*Bottom line:* today's bot is a **deterministic, rule-based, fully-protected** futures
trader with an **opt-in, bounded, statistical** per-coin self-tuning — **no LLM, no trained
model, no black box**. The jump to a real self-training ML model (+ a cheap shared LLM for
news/sentiment) is the plan in [`07-ai-ml-llm-roadmap.md`](./07-ai-ml-llm-roadmap.md).
```
