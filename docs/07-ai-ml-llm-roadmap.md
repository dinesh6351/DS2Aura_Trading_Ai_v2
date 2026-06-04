# 07 — AI / ML / LLM Roadmap: from rule-based to a self-training trading model

> **Goal of this doc:** a complete, honest, cost-aware plan to evolve DS2AuraTrading
> from today's **deterministic rule engine** into a **hybrid system** that adds a
> real-time **ML model** (the predictive core), a real-time **LLM** layer (news /
> sentiment → features + explanations), and an **auto-training (continuous-learning)**
> loop — without ever weakening the safety guarantees that protect real money.
>
> Status: **design / roadmap** (not yet implemented). Read §6 (Safety & anti-patterns)
> before building anything.
>
> **For how the bot works TODAY** (current rule engine, protection, and the auto-learning
> question), see [`08-how-the-bot-works-today.md`](./08-how-the-bot-works-today.md).

---

## 1. Executive summary (read this first)

**The single most important rule:** an **LLM must never decide a trade or place an
order directly.** LLMs are excellent at reading *text* (news, social, filings) and
explaining things; they are **bad and dangerous** at predicting price or sizing risk,
and they hallucinate. Anyone who wires "ChatGPT, should I long BTC?" → market order is
building a money-loss machine.

The winning architecture for retail/quant crypto is a **hybrid stack**:

| Layer | Job | Tech | Touches real money? |
|---|---|---|---|
| **Rule engine** (today) | Hard safety gates + execution | `strategy.ts` (deterministic) | ✅ yes — final authority |
| **ML model** (new core) | Rank setups: *P(this trade wins)* / expected R | Gradient-boosted trees → later temporal/online | ⚠️ advisory → gate, after validation |
| **LLM layer** (new) | Text → numeric features (sentiment, event risk) + plain-English explanations | Cheap model (DeepSeek / Gemini Flash / Haiku), cached & shared | ❌ never — feature only |
| **Auto-train loop** (new) | Retrain ML on fresh outcomes, validate, promote | LightGBM + walk-forward CV + champion/challenger | ❌ proposes models; gated promotion |

The rule engine stays the **boss**: ML and LLM can only make the bot *more selective*,
never bypass a safety gate or place a trade the rules forbid. This is exactly how the
existing `useAdaptiveLearning` feature already behaves — this roadmap is the heavier,
global, self-training version of that idea.

**Realistic expectation:** this can meaningfully improve *trade selection* (win-rate /
profit factor) and *explainability*. It will **not** print money, beat the market every
week, or remove risk. Crypto is non-stationary and adversarial. Treat every claim as a
hypothesis to be proven in **paper mode** before it ever touches live funds.

---

## 2. Where we are today

```
tickUser() every ~60s  ─►  evaluateSymbol(symbol)
                              ├─ klines + funding + multi-TF (Binance)
                              ├─ buildCandleCtx → ~24 weighted conditions
                              ├─ runSafetyCheck → score 0–100 + CRITICAL gates
                              └─ allPass? → openPosition() (paper or live)
                            runWatchdog() → SL / TP / break-even / trailing
```

- **Deterministic & explainable.** Same inputs → same output. No model, no LLM
  (`analysis.service.ts` literally comments *"No LLM"*; zero AI/ML deps).
- **Shared market context** is computed **once for all users** and cached 60s
  (`market.service.ts`) — this multi-tenant cache pattern is the key to keeping any
  future LLM/ML cost low.
- **We already log outcomes:** `Position` (entry features: `entryScore`, `entryBias`,
  SL/TP) and `TradeHistory` (exit, `netPnl`, `exitReason`, duration). That is the seed
  of a training dataset — but it's missing the *full feature vector* at decision time.

**What's missing for ML:** a labeled dataset of *(features at decision time → outcome)*
captured without look-ahead bias. That's Phase 0.

---

## 3. Target architecture (hybrid)

```
                       ┌─────────────────────────────────────────────┐
                       │  SHARED (computed once for all tenants)      │
   Binance ─┬─ OHLCV ─►│  • Market regime (existing)                  │
            ├─ funding │  • LLM news/sentiment per coin (NEW, cached) │
   News API ┴─ headlines │  • Feature snapshots logged → feature store│
                       └───────────────┬─────────────────────────────┘
                                       │ features (numeric)
                  per user, each tick  ▼
   evaluateSymbol ─► rule score ──┐
                                  ├─►  DECISION FUSION (safety-first)
   ML service  ─► P(win)/E[R] ────┘     finalGo = ruleAllPass
   (LightGBM/ONNX)                                  AND mlConfidence ≥ τ
                                                    AND sentiment not red
                                       │
                                       ▼
                              openPosition()  (unchanged execution + watchdog)

   ┌──────────────────────  AUTO-TRAIN LOOP (offline, scheduled)  ──────────────────┐
   │ feature store + outcomes ─► label ─► walk-forward CV ─► challenger model        │
   │   ─► backtest + PAPER eval ─► beats champion? ─► register + promote (gated)     │
   │   ─► drift monitor in prod ─► retrain / fallback-to-rules on drift              │
   └────────────────────────────────────────────────────────────────────────────────┘
```

Three new subsystems: **(A) data/feature store**, **(B) ML inference**, **(C) LLM
features**, all feeding **decision fusion**, plus the **auto-train loop**.

---

## 4. Component deep-dives

### 4.1 Data foundation & feature store (Phase 0 — do this first)

Nothing works without clean, leak-free data. Build this before any model.

- **Snapshot every evaluation**, not just trades taken. Each tick, for each symbol,
  persist the full feature vector the rules saw + the rule score + bias. This becomes
  training data whether or not a trade opened.
- **New table `FeatureSnapshot`** (Prisma): `symbol, ts, features Json, ruleScore,
  bias, marketVerdict, btcTrend, fearGreed, sentiment?, …`. ~30 coins × 1/min ≈ 43k
  rows/day — prune to 90–180 days; cheap on Supabase.
- **Labeling job** (offline): for each snapshot, compute forward outcomes once they're
  knowable: `fwdRet_15m, fwdRet_1h, fwdRet_4h`, and — for snapshots that became trades —
  the realized `R-multiple` and win/loss from `TradeHistory`.
- **Leakage rules (non-negotiable):**
  - Only features available **at or before** decision time (no future bars).
  - **Purge + embargo** around each label window in CV (López de Prado) so a train row
    can't peek at a test row's overlapping future.
  - Split **by time**, never randomly.

**Deliverable:** a reproducible `(X features, y label)` dataset export.

### 4.2 ML predictive model — the "real-time model"

- **Start with gradient-boosted trees (LightGBM or XGBoost).** For tabular indicator
  features this is the industry default: strong, fast (<1 ms inference), robust to noise,
  trains in minutes on CPU, and is **interpretable** (SHAP feature importances). Do **not**
  start with deep learning — it overfits small/noisy financial data and costs more.
- **Target options (pick one to start):**
  - *Classification:* `P(trade hits TP before SL)` or `P(fwdRet_1h > fee+slippage)`.
  - *Regression:* expected forward return or expected R-multiple (lets you rank).
- **Serving — two cheap options:**
  1. **ONNX in Node** (`onnxruntime-node`): export the trained tree to ONNX, run
     inference inside the existing backend. No extra service, no extra cost. *Recommended.*
  2. **Tiny Python FastAPI service** on Railway if you prefer to keep Python end-to-end.
- **Integration:** add an `ml.service.ts` called from `engine.ts` right after
  `evaluateSymbol`. It returns `{ pWin, expR, modelVersion }`.
- **Roll out in stages (critical):**
  1. **Shadow mode** — log the ML prediction next to the rule decision; **don't act**.
     Run for weeks; measure whether ML-high trades really outperform.
  2. **Gate mode** — ML becomes one more *critical gate*: require `pWin ≥ τ` (e.g. 0.55)
     on top of the rules. Only ever *removes* weak trades.
  3. **Rank/blend mode** — use `expR` to rank which setups win the limited open slots.
- **Later (optional):** a temporal model (Temporal-CNN / small Transformer) or an
  **online-learning** model (`River`) that updates incrementally per outcome. Same gates.

### 4.3 LLM layer — the "real-time LLM" (news / sentiment → features)

Use the LLM **only** to turn unstructured text into numbers and explanations.

- **Inputs:** crypto news headlines / RSS (CryptoPanic, CoinDesk, etc.), optionally
  social. The existing `newsResearch` is rule-based — the LLM upgrades it.
- **Task:** per coin, a cheap LLM returns **structured JSON**:
  `{ sentiment: -1..1, eventRisk: low|med|high, catalysts: string[], summary: string }`.
  `sentiment` and `eventRisk` become **numeric features** for the ML model and can act as
  a soft gate (e.g. block new longs on `eventRisk: high` — exchange hack, depeg, etc.).
- **Cost control = the whole game (see §5):**
  - Run sentiment **once per coin every 5–15 min, shared across ALL users** (same
    multi-tenant cache pattern as `getMarketStatus`) — *not* per user, *not* per tick.
  - Use a **cheap model** (DeepSeek, Gemini Flash, or Claude Haiku). Batch coins per call.
  - Cache aggressively; only re-call when new headlines appear.
- **Hard rule:** the LLM's output is **advisory data**. It never sees order endpoints,
  never sizes a position, never overrides a safety gate. Validate its JSON; on any
  parse/timeout error → treat as neutral and fall back to rules.

### 4.4 Auto-training / continuous-learning loop — "auto train, start over model"

This is the "model retrains itself" piece. Done wrong it's how people blow up; done
right it keeps the edge fresh as the market drifts.

```
nightly/weekly cron ─►
  1. pull new (features → outcome) rows since last run
  2. walk-forward / purged CV train  → CHALLENGER model
  3. evaluate OOS: AUC / precision@k / expected-R, calibration
  4. PAPER gauntlet: run challenger in shadow vs champion on recent live ticks
  5. promote ONLY if challenger beats champion on OOS *and* paper, by a margin
  6. write to model registry (versioned); keep champion as instant rollback
  7. PROD drift monitor: if live calibration degrades → retrain or fall back to rules
```

- **Walk-forward only.** Train on `[t0, t1]`, validate on `[t1, t2]`, roll forward.
  Random k-fold leaks the future and will lie to you.
- **Champion–challenger + model registry.** New models are *proposed*, not trusted.
  Versioned artifacts in Supabase storage / MLflow; `BotConfig`-level pin of the active
  version; one-click rollback.
- **Promotion gates (auto, but conservative):** challenger must beat champion on
  out-of-sample metrics **and** in a paper/shadow run, by a meaningful margin, with
  acceptable calibration. Optionally require a human "approve" click for live promotion.
- **Drift detection in prod:** track predicted `pWin` vs realized win-rate (calibration
  curve), and feature distribution shift. On drift → trigger retrain, and meanwhile
  **degrade gracefully to the pure rule engine** (which always works).
- **Connect to existing `useAdaptiveLearning`:** that already tunes the per-coin score
  bar from the user's own closed trades. Keep it as the lightweight per-user layer; the
  auto-train loop is the heavier global model. They're complementary.
- **Cadence:** start **weekly** retrain (crypto regimes shift fast but you need enough
  new samples). Online/incremental updates are an optional add-on, same gates.

### 4.5 Decision fusion — how rules + ML + LLM combine (safety-first)

```
go = rule.allPass                       # deterministic gates — unchanged, mandatory
   AND ml.pWin >= τ                     # ML can only ADD selectivity
   AND llm.eventRisk != 'high'          # text risk veto for new entries
size = base × clamp(f(ml.expR, confidence))   # never exceed configured max risk
rank = ml.expR                          # decides which setups win open slots
```

- ML/LLM may only **subtract** trades or **shrink** size, **never** add a trade the
  rules reject or exceed risk limits. The safety gates remain the final authority.
- Every decision stays **explainable**: log `ruleScore`, `pWin`, `sentiment`, and the
  binding reason — feeds straight into the dashboard's existing "why gated" hover.

### 4.6 Reinforcement learning (Phase 4 — research only, optional)

RL (e.g. PPO) for **position sizing / exit timing** (not entry-from-scratch) is the
"advanced" frontier. **Be honest:** RL in live trading is sample-inefficient, unstable,
and easy to overfit to a backtest. Only attempt after the supervised stack is proven,
and keep it paper-only for a long time. For most of the value, you won't need it.

---

## 5. Cost analysis & optimization (the "improve cost" ask)

Today's rule engine is ~free to run. Adding ML/LLM adds cost — here's how to keep it tiny.

| Component | Naive (expensive) | Optimized (cheap) | Est. cost |
|---|---|---|---|
| **ML inference** | separate GPU service | **ONNX in the existing Node backend**, CPU | ~$0 extra |
| **ML training** | always-on GPU box | weekly job on Railway cron / cheap CPU spot / your own machine | cents–$ / month |
| **LLM sentiment** | per-user, per-tick, frontier model | **shared across all users**, 1×/coin/10min, **cheap model**, cached, batched | see below |
| **Feature store** | unbounded growth | prune to 90–180 days, compress JSON | low (Supabase) |
| **News feed** | paid API | free tiers (CryptoPanic/RSS) first | $0 |

**LLM cost worked example (the big lever is sharing + caching):**
- 30 coins, sentiment refreshed every 10 min = 30 × 6 = **180 refreshes/hour**, but
  **batch** ~10 coins/call → ~18 calls/hour → ~**430 calls/day**, *shared by every user*.
- A cheap model at fractions of a cent per short call ⇒ **roughly cents to ~$1–2/day**
  regardless of user count, because it's computed once and reused (same pattern as
  `getMarketStatus`). Per-user-per-tick instead would be **100–1000× more** — don't.

**Cost rules of thumb:**
1. **Compute shared things once.** News/sentiment/regime are global — never per user.
2. **Cache by content hash.** Re-call the LLM only when headlines actually change.
3. **Cheapest model that passes a quality bar.** Sentiment classification doesn't need a
   frontier model — DeepSeek / Gemini Flash / Haiku are plenty.
4. **Keep ML inference in-process (ONNX).** No second service to pay for or operate.
5. **Train offline, infrequently.** Training is the heavy part; do it weekly, not live.
6. **Always have the free fallback.** If any paid component is down/over-budget, the
   deterministic rules keep trading. Set a hard monthly $ cap with auto-disable.

---

## 6. Safety, risk & anti-patterns (must-read before building)

**Do NOT:**
- ❌ Let an LLM place or size trades, or override a safety gate. (Feature/advisory only.)
- ❌ Use random/k-fold CV on time series — it leaks the future and inflates results.
- ❌ Auto-deploy a freshly trained model to **live** money without OOS + paper gates.
- ❌ Backtest without realistic **fees, funding, slippage**, and min-notional — or you'll
  ship a "profitable" model that loses live.
- ❌ Overfit to one regime (e.g. a 2024 bull run). Validate across bull/bear/chop.
- ❌ Trust a high backtest Sharpe. Assume it's optimistic; prove it forward in paper.

**Do:**
- ✅ Keep deterministic safety gates as the **final authority**, always.
- ✅ **Paper-first**: every model/feature proven in paper before live (the platform
  already defaults new users to paper — reuse that).
- ✅ Walk-forward validation with purge + embargo.
- ✅ Champion–challenger with instant rollback + drift monitoring.
- ✅ Graceful degradation to pure rules on any ML/LLM failure or budget cap.
- ✅ Unchanged risk limits: max concurrent, daily cap, margin guard, SL/TP, loss streak.
- ✅ Honest metrics & disclaimers to users. No "AI guarantees profit" claims.

**Reality check:** markets are non-stationary and adversarial. The realistic win is a
*better-selected, better-explained* trade stream and faster adaptation — **not** certainty.

---

## 7. Integration map to the current codebase

| New piece | Where it plugs in |
|---|---|
| `FeatureSnapshot`, `ModelVersion`, label fields | `backend/prisma/schema.prisma` (+ `prisma db push`) |
| Snapshot logging | inside `evaluateSymbol` / end of `tickUser` (`engine.ts`) |
| `ml.service.ts` (ONNX inference → `{pWin, expR, version}`) | called in `engine.ts` after scoring |
| Decision fusion (`go`, `size`, `rank`) | `engine.ts` open-trade block + `strategy.ts` gate list |
| `sentiment.service.ts` (shared, cached LLM) | new shared module, same pattern as `market.service.ts` |
| Training + labeling jobs | new `backend/jobs/` cron(s) or a small Python service on Railway |
| Model registry / artifacts | Supabase storage (versioned) + a `ModelVersion` table |
| "Why gated" explanations | extend the existing `criticalFails` / `weakConditions` hover |

Everything additive — the rule engine path keeps working untouched if every new piece
is disabled.

---

## 8. Phased roadmap (with go/no-go gates)

| Phase | What | Rough effort | Go-live gate before next phase |
|---|---|---|---|
| **0. Data foundation** | `FeatureSnapshot` logging + labeling job + dataset export | 1–2 wks | ≥30–60 days of clean, leak-free labeled data |
| **1. ML core (shadow→gate)** | LightGBM model, ONNX serving, shadow logging → gate mode | 2–4 wks | ML-gated trades beat rules-only in **paper** on OOS period |
| **2. LLM sentiment feature** | shared cached sentiment/event-risk → feature + soft veto | 1–2 wks | sentiment improves calibration / cuts bad trades in paper; cost within cap |
| **3. Auto-train loop** | walk-forward retrain + champion/challenger + drift monitor | 2–4 wks | challenger promotion is safe, gated, reversible; drift fallback works |
| **4. (optional) RL / temporal** | sizing/exit RL or temporal model | research | paper-only until clearly superior |

Ship each phase **behind a flag**, default OFF, prove it in **paper**, then enable.

---

## 9. Recommended tech stack

- **ML:** Python + **LightGBM/XGBoost**, scikit-learn, pandas, **SHAP** (explainability),
  **River** (optional online learning). Export to **ONNX**; serve via `onnxruntime-node`.
- **Backtesting / validation:** `vectorbt` or a custom walk-forward harness with
  purge+embargo; always include fees/funding/slippage.
- **LLM (sentiment):** a cheap API — **DeepSeek**, **Gemini Flash**, or **Claude Haiku** —
  with strict JSON output, batching, and content-hash caching.
- **News:** free tiers first (CryptoPanic, RSS) before any paid feed.
- **Orchestration:** Railway **cron** for labeling + weekly retrain; model artifacts +
  `ModelVersion` registry in **Supabase**; optional **MLflow** for experiment tracking.
- **Data:** Supabase Postgres for the feature store (prune old rows); object storage for
  model binaries.

---

## 10. How to measure success (KPIs)

- **Trade quality:** win-rate, **profit factor**, expectancy (avg R), max drawdown —
  ML-on vs rules-only, on **out-of-sample / paper** periods.
- **Model health:** OOS AUC / precision@k, **calibration** (predicted vs realized win-rate).
- **Drift:** rolling calibration error; feature-distribution shift alerts.
- **Cost:** $/day for LLM + training vs the rule-only baseline (must stay under cap).
- **Safety:** zero cases of ML/LLM overriding a gate; graceful-fallback events handled.

Compare **always against the rules-only baseline** — if the model can't beat free, don't
ship it.

---

## 11. Open decisions for you

1. **Serving:** ONNX-in-Node (cheapest, recommended) vs a separate Python service?
2. **First ML target:** classification `P(win)` vs regression `E[R]`?
3. **LLM provider** for sentiment (DeepSeek / Gemini Flash / Haiku) + a **monthly $ cap**?
4. **Promotion policy:** fully-automatic gated promotion, or require a human "approve"
   click before a new model controls **live** funds?
5. **Scope of v1:** ship Phase 0+1 (ML gate) first and defer LLM/auto-train, or go wider?

---

*Bottom line:* keep the deterministic engine as the safety spine, add an ML model as the
selective brain (validated in paper, served cheaply via ONNX), add a cheap **shared**
LLM only for text→features, and wrap it in a **gated, reversible** auto-train loop. That's
the realistic path to a stronger, self-improving crypto bot — at near-zero added cost and
without betting real money on an unproven model.
