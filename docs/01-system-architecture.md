# 01 · System Architecture

## 1. Goal

Turn the single-tenant `claude-execute` bot into a **multi-tenant SaaS**: every client connects
their **own** Binance account, runs their **own** isolated bot, and the platform earns a
**$10/month subscription** (150 trades included, then $0.10/extra trade; 30-day free trial). Must
scale 10 → 10,000 users with no architecture rewrite.

## 2. High-level diagram

```
                         ┌──────────────────────────────────────────────┐
   Browser / Mobile ───▶ │  FRONTEND  (Next.js 15 on Vercel)             │
   (PWA / RN later)       │  user dashboard · onboarding · admin CRM      │
                         └───────────────┬───────────────┬──────────────┘
                                  HTTPS REST│        WSS /ws│ (realtime per-user channels)
                         ┌────────────────▼───────────────▼──────────────┐
                         │  BACKEND  (Express + TS on Railway)            │
                         │  ┌──────────┬───────────┬──────────────────┐  │
                         │  │  API     │  Realtime  │  Bot Worker      │  │
                         │  │ /api/*   │  WS hub    │  (manager loop)  │  │
                         │  └────┬─────┴─────┬──────┴────────┬─────────┘  │
                         │  auth · rbac · tenant-scoped services          │
                         └────┬───────────────┬───────────────┬──────────┘
                  Prisma SQL  │     per-user   │ decrypt keys  │ shared mkt data
                    ┌─────────▼───┐   ┌────────▼─────────┐  ┌──▼───────────────┐
                    │ PostgreSQL  │   │ Binance /fapi     │  │ Binance spot +    │
                    │ (Supabase)  │   │ (per-tenant keys, │  │ alternative.me    │
                    │ 19 tables   │   │  signed orders)   │  │ (F&G) — cached    │
                    └─────────────┘   └───────────────────┘  └───────────────────┘
```

## 3. Multi-tenancy — how isolation is guaranteed

Isolation is enforced at **three** layers so a single bug can't leak data:

1. **Identity** — the acting `userId` comes *only* from the verified JWT `sub`
   (`middleware/auth.ts`). Clients can never pass a `userId` in a body/param to act as someone else.
2. **Query scoping** — every service method filters by that `userId`. There is no unscoped
   `findMany` on tenant data. Admin endpoints are the only cross-tenant readers and sit behind
   `requireStaff`/`requireRole`.
3. **Database (optional, recommended on Supabase)** — Postgres **Row-Level Security**: a policy
   `userId = auth.uid()` on every tenant table makes cross-tenant reads impossible even if app code
   has a bug. See `docs/02-database-schema.md §RLS`.

Per-tenant **secrets**: each user's Binance keys are encrypted with AES-256-GCM (`lib/crypto.ts`)
and only ever decrypted inside the bot engine at tick time — never returned to any client, never logged.

## 4. The bot: from one cron to N tenants

| | claude-execute (single) | SaaS (multi) |
|---|---|---|
| Trigger | Railway cron `*/5` or one WS process | `bot/manager.ts` sweep every 60s |
| Keys | 1 global key from env | per-user encrypted key, decrypted per tick |
| Concurrency | 1 account | every `RUNNING` BotConfig, fanned out (10 at a time) |
| Idempotency | n/a | per-user Redis lock (`bot:lock:<userId>`) so replicas never double-tick |
| Decision logic | `runSafetyCheck` | **identical** `runSafetyCheck` (ported to TS) |
| Watchdog | dashboard 30s loop | `engine.runWatchdog` per tenant, every tick |

Shared market context (BTC trend, verdict, F&G) is computed **once per 60s** and reused by all
tenants — 100 users = 1 BTC fetch, not 100. This is the key cost/rate-limit optimization.

## 5. Scaling path (no rewrite)

| Users | Topology | What changes |
|---|---|---|
| **10–100** | 1 backend process (API+WS+worker), 1 Postgres | nothing — current default (`RUN_WORKERS=true`) |
| **100–1k** | 2–3 web replicas (`RUN_WORKERS=false`) + 1 dedicated worker (`npm run worker`); Redis for locks + rate-limit | flip env flags; add Redis URL |
| **1k–10k** | N web replicas; **sharded workers** (`userId % N`) or a **BullMQ job queue** where each tick is a job; Postgres read-replicas + PgBouncer | workers pull jobs instead of scanning; locks already make this safe |
| **10k+** | Queue + autoscaled worker pool; partition `positions`/`trade_history` by month; move realtime to Supabase Realtime or a dedicated WS tier | data partitioning + managed realtime |

The seams that make this work are already in place: **stateless API**, **per-user locks**,
**shared-cache market data**, **Decimal money**, and a **worker that's separable from the web tier**.

## 6. Request lifecycle (example: user opens dashboard)

```
GET /api/trading/account
  → apiLimiter (rate limit)
  → authenticate (verify JWT → req.auth.userId)
  → tradingService.account(userId)         // scoped query
  → ok(res, data)                           // { ok:true, data }
WS /ws?token=…  → verify token → subscribe user:<id>:positions  (refused if not own channel)
Bot tick later → realtime.publish(user:<id>:positions, …) → browser updates live
```

## 7. Component responsibilities

| Component | File(s) | Responsibility |
|---|---|---|
| Config | `config/env.ts` | validate env at boot, fail fast |
| Crypto vault | `lib/crypto.ts` | AES-256-GCM encrypt/decrypt keys, HMAC signing |
| Auth | `modules/auth/*`, `lib/jwt.ts` | register/login/refresh/2FA, session rotation |
| Tenant guard | `middleware/auth.ts`, `rbac.ts` | identity + role gates |
| Per-tenant exchange | `modules/binance/binance.client.ts` | signed orders bound to one user's keys |
| Shared market | `modules/binance/market.service.ts` | BTC trend/verdict/F&G, cached |
| Strategy | `modules/bot/strategy.ts`, `indicators.ts` | 19-condition engine (ported 1:1) |
| Engine | `modules/bot/engine.ts` | per-user evaluate + execute + watchdog |
| Orchestrator | `modules/bot/manager.ts` | tick all running tenants, locked |
| Analysis | `modules/bot/analysis.service.ts` | AI trade plan, multi-TF S/R |
| Trading reads | `modules/trading/*` | dashboard data, performance, CSV |
| Revenue | `modules/fees/*` | subscription billing, usage metering, monthly invoices |
| Admin CRM | `modules/admin/*` | metrics, controls, audit |
| Realtime | `modules/notifications/realtime.ts` | per-user WS channels |
```
