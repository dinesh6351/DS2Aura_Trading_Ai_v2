# V2 — Build Status & Tracker

Living tracker for Version 2. Full plan: [`FINAL_TRADING_AGENT_MASTER_PLAN.md`](./FINAL_TRADING_AGENT_MASTER_PLAN.md).

**V2 baseline:** copied from V1 at the same feature set (deterministic rule engine + protection +
paper/live + opt-in adaptive learning + dashboard). Clean git history, no secrets carried over.

## Phase status

| Phase | Goal | Status |
|---|---|---|
| **Setup** | New private repo, V1 baseline copied, scaffold | ✅ done |
| **P0** | Feature Store logging + labeling + risk-event table + worker split | ⬜ not started |
| **P1** 🥇 | Institutional Risk Manager (drawdown kill-switch, loss limits, exposure/correlation caps, vol-scaled sizing, circuit breakers) | ⬜ not started |
| **P2** 🥈 | ML conviction model (LightGBM → ONNX), shadow → gate | ⬜ not started |
| **P3** | Cheap shared LLM sentiment / event-risk guard | ⬜ not started |
| **P4** | Multi-exchange `ExchangeAdapter` (Binance → Bybit → OKX → Bitget → CoinEx) | ⬜ not started |
| **P5** | Gated auto-train loop (champion/challenger + rollback) | ⬜ not started |
| **P6** | VPS migration + worker split + monitoring/backups | ⬜ not started |

## Next action

Pick the next phase to build. Recommended first feature: **P1 Risk Manager** (capital preservation)
or **P0 Feature Store** (start collecting training data — needs 30–60 days before ML is useful).

## Ground rules (do not break)

- Keep the deterministic safety gates as the **final authority**; ML/LLM may only make the bot
  *more* selective, never bypass a gate or exceed risk limits.
- The **LLM never sizes or places a trade** — text → features only.
- Every change ships behind a flag, **default OFF**, proven in **paper → shadow → small-live**.
- No secrets in git. Real keys live only in `.env` (gitignored) / a secrets manager.
