# CLAUDE.md — project guide for Claude Code

> Loaded automatically when working in this repo. Keep it short, accurate, and secret-free.

## What this is
**DS2Aura Trading AI** — a multi-tenant SaaS where each user runs an **isolated, deterministic** Binance USDT-M Futures bot on **their own exchange account + their own encrypted API keys**. **Non-custodial** (the platform never holds or moves user funds) and **rule-based** (no LLM / no ML model in the trade path today).

- **V1** = live product. **V2** = the evolution (this repo if `docs/V2-STATUS.md` exists) built per the master plans.
- Positioning: **software / automation, not financial advice**. Never use "guaranteed profit / no-loss / returns" language anywhere.

## Monorepo layout
```
backend/   Express + TypeScript + Prisma (engine, trading, billing, admin, auth)
frontend/  Next.js 15 (App Router) + Tailwind (dashboard, settings, onboarding, admin)
shared/    types/DTOs/enums shared by both
docs/      master plans (see docs/FINAL_TRADING_AGENT_MASTER_PLAN.md → doc index)
```

## Commands
- Install/build all: `npm run setup` (root). Per workspace: `npm run dev`, `npm run build`.
- **Typecheck (always run before committing):** in `backend/` and `frontend/` → `npx tsc --noEmit`.
- Prisma: `npm run db:generate`, `npm run db:push` (schema → DB), `npm run db:migrate`.
- Local env: copy `backend/.env.example` → `backend/.env` (+ frontend) and fill. **`.env` is gitignored — never commit secrets.**

## Key files (trading core)
- `backend/src/modules/bot/manager.ts` — 60s sweep, per-user Redis lock, daily reset.
- `backend/src/modules/bot/engine.ts` — `tickUser`: sync → watchdog → risk gates → score → open.
- `backend/src/modules/bot/strategy.ts` — ~24 conditions + **5 critical gates**; score 0–100 (threshold default 85).
- `backend/src/modules/bot/learning.service.ts` — opt-in per-coin score-bar tuning (`useAdaptiveLearning`).
- `backend/src/modules/binance/market.service.ts` — shared regime/F&G, cached 60s (compute once for all tenants).
- `backend/prisma/schema.prisma` — 19 tables; money is `Decimal(38,18)` (never Float).

## Conventions
- **Per-tenant isolation:** every query scopes by `userId`; the Binance client is instantiated per user.
- **Shared, cached** market data (regime, F&G, future sentiment) — compute once, reuse for all users (key cost lever).
- **Safety gates are the final authority** — adaptive learning / future ML may only make the bot *more* selective, never bypass a gate or risk limit.
- Match surrounding code style; keep diffs minimal; run typecheck before committing.

## Deploy (Railway + Supabase)
- Two Docker services (backend `Aura_BackEnd`, frontend `Aura_Frontend`) + Supabase Postgres.
- Auto-deploy from `main` is **flaky** — confirm via GitHub commit status (see the `deploy-check` skill) and force-deploy by SHA if it skips.
- Schema changes need `prisma db push` to prod **before** redeploy.

## Common diagnostics
- **"Bot makes no trades"** → almost always the **HIGH_RISK market-verdict critical gate** (Fear&Greed ≤20/≥80 or BTC 4h ATR >4%), which vetoes *all* entries (live + paper). A symbol can score above the threshold and still be gated. Not a bug.
- A high score that won't trade is almost always a **critical gate**, not the score.

## Hard rules
- Non-custodial — never design anything that holds/moves user funds.
- No profit/guarantee claims in code, copy, or docs.
- Secrets only in `.env` / a secrets manager — never in git.
- New trading behavior ships behind a flag, default OFF, validated in **paper** first.

See `docs/FINAL_TRADING_AGENT_MASTER_PLAN.md` for the full tech + business doc set.
