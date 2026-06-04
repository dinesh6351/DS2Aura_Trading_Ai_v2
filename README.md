# 🚀 DS2Aura Trading AI — Version 2

> **V2 is the evolution of V1**, built on the same proven, deterministic core but adding the
> upgrades from the master plan — **capital-preservation-first** risk management, an **ML
> conviction layer**, **multi-exchange** support, and a cheap **shared LLM** for news/sentiment.
> V1 keeps running untouched in its own repo.
>
> 📘 **Read first:**
> - 🗂️ [`docs/README.md`](docs/README.md) — **master index + end-to-end setup (START HERE)**
> - [`docs/FINAL_TRADING_AGENT_MASTER_PLAN.md`](docs/FINAL_TRADING_AGENT_MASTER_PLAN.md) — the full V2 blueprint
> - [`docs/08-how-the-bot-works-today.md`](docs/08-how-the-bot-works-today.md) — how the engine works today
> - [`docs/07-ai-ml-llm-roadmap.md`](docs/07-ai-ml-llm-roadmap.md) — ML/LLM detail
>
> **V2 build order (from the master plan):** P0 Feature Store → **P1 Risk Manager** 🥇 → P2 ML
> conviction (shadow→gate) → P3 shared LLM sentiment → P4 multi-exchange adapter → P5 gated
> auto-train → P6 VPS migration + monitoring.
>
> 🔑 **Principles:** capital preservation first · avoid bad trades · fewer & better, not more ·
> the LLM never places trades · every change proven in **paper → shadow → small-live**.

---

## What this is (carried from V1)

Multi-tenant SaaS that turns the single-user **Claude-Execute** Binance Futures bot into a
platform where **each user connects their own exchange account, runs their own isolated bot, and
the platform earns a subscription.**

> ⚠️ Real-money system. Every user trades their own live Binance account. Treat encryption keys,
> JWT secrets and the database as production secrets from day one.

---

## Monorepo layout

```
saas-platform/
├── backend/          # Express + TypeScript API, bot engine, fee engine, Prisma
│   ├── prisma/       # PostgreSQL schema + migrations
│   └── src/
│       ├── config/   # env validation
│       ├── lib/      # prisma client, AES-256 crypto, logger, redis
│       ├── middleware # auth (JWT), RBAC, tenant isolation, rate-limit, errors
│       ├── modules/  # auth, users, apikeys, binance, bot, trading, fees, admin, notifications
│       └── jobs/     # background workers (bot ticks, fee settlement, watchdog)
├── frontend/         # Next.js 15 (App Router) + Tailwind + Shadcn UI
├── shared/           # Types shared between backend & frontend (DTOs, enums)
├── docs/             # Architecture, DB, API, security, deployment, roadmap
└── infra/            # Railway / Vercel / Supabase deploy descriptors
```

## Quick start (local dev)

```bash
# 0. prerequisites: Node 20+, a PostgreSQL URL (Supabase free tier works)
cd saas-platform
npm run setup                     # install all workspaces + build shared + prisma generate

# 1. backend env
cp backend/.env.example backend/.env   # fill DATABASE_URL, JWT secrets, API_KEY_ENC_KEY

# 2. database
npm run db:migrate                 # create tables
npm run db:seed --workspace=backend   # create the initial ADMIN user

# 3. run (two terminals)
npm run dev:backend                # http://localhost:4000  (builds shared first)
npm run dev:frontend               # http://localhost:3000
```

> The `shared` workspace must be built before the backend can import `@platform/shared`.
> `npm run setup` and `npm run dev:backend` both do this for you.

Generate the 32-byte encryption key once and put it in `backend/.env` as `API_KEY_ENC_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Where the original bot lives

The strategy engine (`runSafetyCheck`, indicator math, 19-condition scoring) is ported from
`../claude-execute/bot.js` into `backend/src/modules/bot/strategy.ts`. The **decision logic is
unchanged**; only the *execution* layer is rewritten to be per-tenant (each user's encrypted keys,
isolated positions, isolated risk caps).

## Documentation

| Doc | Purpose |
|---|---|
| [docs/01-system-architecture.md](docs/01-system-architecture.md) | Components, multi-tenancy, data flow, scaling 10→10k users |
| [docs/02-database-schema.md](docs/02-database-schema.md) | All 19 tables, relationships, indexes, RLS |
| [docs/03-api-documentation.md](docs/03-api-documentation.md) | Every REST endpoint, request/response, auth |
| [docs/04-security-checklist.md](docs/04-security-checklist.md) | Encryption, RBAC, rate limiting, audit, secrets |
| [docs/05-deployment-guide.md](docs/05-deployment-guide.md) | Railway + Vercel + Supabase, env, CI/CD |
| [docs/06-production-roadmap.md](docs/06-production-roadmap.md) | Phased plan from MVP to 10k users |

## Status

**Phase 1 — foundation.** Schema, secure backend core, auth, per-tenant bot/fee engines and
frontend scaffold are in place. See the roadmap for what each subsequent phase hardens.
