# 05 · Deployment Guide

Target stack (free-first): **Frontend → Vercel**, **Backend → Railway**, **DB → Supabase Postgres**,
**Realtime → backend WS (or Supabase Realtime)**, **Errors → Sentry**, **Analytics → PostHog**.

## 0. One-time prep
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # API_KEY_ENC_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT_REFRESH_SECRET
```

## 1. Database — Supabase
1. Create a project → copy the **Connection string** (pooled, port 6543) → `DATABASE_URL`,
   and the **direct** string (port 5432) → `DIRECT_URL`.
2. Locally: `cd backend && npm run db:deploy && npm run db:seed` (creates the ADMIN user).
3. (Recommended) enable RLS policies from `02-database-schema.md`.

## 2. Backend — Railway
1. New project → add a service from the GitHub repo, **root directory = `backend`** (or monorepo + build filter).
2. Build: `npm install && npm run build && npm run db:deploy`. Start: `npm run start`.
3. Add env vars (all of `backend/.env.example`): `DATABASE_URL`, `DIRECT_URL`, `JWT_*`,
   `API_KEY_ENC_KEY`, `PUBLIC_APP_URL` (your Vercel URL), `PLATFORM_FEE_BPS=100`, optional Redis/Telegram/Sentry.
4. **Scale split (≥100 users):** run a second Railway service from the same repo with start
   `npm run worker` and set `RUN_WORKERS=false` on the web service so only the worker ticks bots.

### ⚠ Binance HTTP 451 (the gotcha carried over from claude-execute)
Binance blocks many datacenter IPs (451). Market data already uses the **spot host**
(`api.binance.com`), blocked less often. If signed calls still 451:
- Pin the worker service to a reachable datacenter (verified: **`asia-southeast1-eqsg3a`**) via
  Railway **`multiRegionConfig`** (the plain `region` field no-ops):
  ```graphql
  mutation { serviceInstanceUpdate(serviceId:"<svc>", environmentId:"<env>",
    input:{ multiRegionConfig:{ "asia-southeast1-eqsg3a": { numReplicas: 1 } } }) }
  ```
- Probe candidates by deploying the original `probe.js` pattern and reading logs for 200 vs 451.
- If GitHub auto-deploy doesn't fire, force-deploy via GraphQL `serviceInstanceDeployV2(…, commitSha)`
  and poll `deployments(first:1)` until `SUCCESS` (same workaround as the original project).

## 3. Frontend — Vercel
1. Import the repo, **root directory = `frontend`**.
2. Env: `NEXT_PUBLIC_API_URL=https://<your-railway-backend>`.
3. Deploy. Update the backend's `PUBLIC_APP_URL` to the Vercel domain (CORS + cookies).

## 4. Redis (≥100 users) — Railway/Upstash
Set `REDIS_URL`. Enables cross-replica rate limiting + bot locks + realtime fan-out. Without it the
app runs single-process (fine for ≤100 users).

## 5. Smoke test
```bash
curl $API/healthz                       # {ok:true}
curl $API/readyz                        # {ok:true, db:true}
# register → connect a TESTNET key → start bot → watch /api/bot/log
```
Use `PAPER_TRADING`-style caution: onboard your own account first, tiny size, before opening signups.

## 6. CI/CD (suggested)
- GitHub Actions: on PR → `npm ci && npm run typecheck && npm run build` for all workspaces.
- On merge to `main` → Vercel auto-deploys frontend; Railway deploys backend (or force-deploy step).
- DB migrations run via `npm run db:deploy` as a Railway pre-deploy/release command.

## 7. Environments
Keep **staging** (separate Supabase project + Railway env + Binance testnet) and **production**
fully isolated. Never point staging at production keys or DB.
```
