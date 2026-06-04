---
name: run-app
description: Launch this trading-platform app locally (backend API + Next.js frontend) to verify a change works in the real app, not just tests. Use when asked to run/start the app, screenshot it, or confirm a fix end-to-end.
---

# Run the app locally

Monorepo: `backend/` (Express API + bot worker), `frontend/` (Next.js 15), `shared/` (types).

## First-time setup
```bash
npm run setup                      # installs all workspaces + builds shared + prisma generate
cp backend/.env.example backend/.env     # fill DATABASE_URL, JWT secrets, API_KEY_ENC_KEY (32-byte base64)
cp frontend/.env.example frontend/.env   # if present
```
- Use a **separate Supabase project** for local/dev so you never touch prod data.
- `backend/src/config/env.ts` validates env at boot and **fails fast** if a secret is missing/wrong size.

## Start (two terminals)
```bash
# backend (API on :4000 by default; bot worker can run in-process)
cd backend && npm run dev
# frontend (Next.js on :3000)
cd frontend && npm run dev
```
Open http://localhost:3000 . Frontend proxies `/api/*` to the backend (same-origin) — see `frontend/next.config.mjs`.

## Verify a change without trading real money
- New users default to **PAPER** mode — the bot simulates fills on live prices, no real orders. Safe to exercise end-to-end.
- Health: `GET /healthz` (liveness), `/readyz` (DB). 
- To run the bot worker standalone: `cd backend && npm run worker`.

## Before committing
Always typecheck both workspaces:
```bash
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

## Notes
- Redis is optional locally (falls back to an in-memory shim); required in prod for multi-process locks.
- Never commit `.env`. Never point dev at the prod database for write tests.
