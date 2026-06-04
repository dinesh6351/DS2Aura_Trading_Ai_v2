---
name: deploy-check
description: Confirm a pushed commit actually deployed on Railway for this project. Railway's GitHub auto-deploy webhook is flaky here and silently skips commits. Use after pushing to main, or when asked "is this live / did it deploy?".
---

# Deploy check (Railway)

This project deploys two Docker services from `main` (backend `Aura_BackEnd`, frontend `Aura_Frontend`) on Railway, plus Supabase Postgres. Auto-deploy is **unreliable** — always verify.

## 1. Identify the repo + commit
```bash
git remote get-url origin           # → owner/repo
git rev-parse --short HEAD          # → the SHA you pushed
```

## 2. Check GitHub commit status (Railway posts build status here)
```bash
gh api repos/<owner>/<repo>/commits/<sha>/status \
  --jq '{state:.state, ctx:[.statuses[]|{c:.context,s:.state}]}'
```
- `pending` → still building. `success` → both services deployed. `failure` → build failed.
- Also confirm a deployment exists for the SHA:
  `gh api repos/<owner>/<repo>/deployments --jq '.[0:3][]|{sha:.sha[0:7],env:.environment,created:.created_at}'`

## 3. Wait for green (background poll — don't block)
Run a background loop polling the status every 30s until `state != pending`, then report which services went `success`. Builds usually finish in ~2–4 min (the Next.js frontend is the slower one).

## 4. If auto-deploy SKIPPED the commit
Force-deploy the exact SHA via Railway's GraphQL `serviceInstanceDeployV2(environmentId, serviceId, commitSha)`. This needs a **project-scoped Railway token the USER provides** (used as `Authorization: Bearer <token>`); the Railway CLI rejects workspace tokens. See the `railway-ops` skill for the exact mutation + IDs.

## Notes
- Docs-only commits still trigger a (harmless) rebuild — no need to poll those unless asked.
- From some local networks the `*.up.railway.app` health URLs fail DNS (`ENOTFOUND`); rely on the GitHub commit status instead, which is authoritative for "did it deploy".
- Schema changes must `prisma db push` to prod **before** the deploy or the app breaks.
