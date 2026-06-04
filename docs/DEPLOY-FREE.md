# Deploy guide — free / low‑cost hosting

**Recommended stack:** Frontend + Backend on **Railway** (one platform, one region — important for Binance), Database on **Supabase** (already set up). Vercel is a great free alternative for the frontend if you prefer.

> ⚠️ **Binance HTTP 451 reality.** Binance blocks most datacenter IPs for *signed/trading* calls (HTTP 451). The dashboard works from anywhere, but the **bot's trading calls need a Binance‑reachable IP**. On Railway, pin the backend service to the **Singapore Equinix region** (`asia-southeast1-eqsg3a`) via the service's `multiRegionConfig` (the same fix that worked for `claude-execute`). Render's free tier also *spins down* after 15 min idle — bad for a 24/7 bot. So a truly "always‑free" trading bot isn't realistic; Railway's hobby credit is the cheapest reliable option.

---

## 0. Push to GitHub
```
cd saas-platform
git init && git add -A && git commit -m "SaaS trading platform"
gh repo create ds2aura-trading --private --source . --push   # or create on github.com and push
```

## 1. Database — Supabase (already done)
You already have a Supabase Postgres (ap‑northeast‑1). The schema is synced. Reuse the same `DATABASE_URL` / `DIRECT_URL` (password `@` URL‑encoded as `%40`). For a brand‑new DB, run once: `npm run db:push --workspace=backend`.

## 2. Backend — Railway (Docker)
1. New Project → Deploy from GitHub repo.
2. Service settings:
   - **Root Directory:** `saas-platform`
   - **Dockerfile Path:** `backend/Dockerfile`
   - **Region:** pin to Singapore (`asia-southeast1-eqsg3a`) — use `multiRegionConfig`, NOT the deprecated `region` field.
   - **Healthcheck Path:** `/readyz`
   - **Restart Policy:** Always
3. Env vars (see list below). Set `RUN_WORKERS=true` (runs the bot manager in‑process).
4. Deploy → copy the public URL, e.g. `https://backend-xxxx.up.railway.app`.

## 3. Frontend — Railway (Docker) or Vercel
**Railway (Docker):**
- Root Directory `saas-platform`, Dockerfile Path `frontend/Dockerfile`.
- Build ARG / variable **`NEXT_PUBLIC_API_URL`** = the backend URL from step 2 (must be set at *build* time).
- Healthcheck `/login`.

**Vercel:** Root Directory `saas-platform`; Build Command `npm run build --workspace=shared && npm run build --workspace=frontend`; Output `frontend/.next`; env `NEXT_PUBLIC_API_URL` = backend URL.

## 4. Wire the two together
- On the **backend**, set `PUBLIC_APP_URL` = the frontend's public URL (CORS allows it; the refresh cookie is `SameSite=None; Secure` in prod so cross‑domain login persists).
- Redeploy backend after setting `PUBLIC_APP_URL`.

## 5. Env vars

**Backend:**
| var | value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` (Railway injects its own; the app reads `PORT`) |
| `DATABASE_URL` | Supabase pooler URL (`%40` for `@`) |
| `DIRECT_URL` | Supabase session pooler (5432) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | long random strings |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | e.g. `900` / `2592000` |
| `API_KEY_ENC_KEY` (AES‑256 key for Binance/Telegram encryption) | 32‑byte hex/base64 — **keep stable**, rotating it invalidates stored keys |
| `PUBLIC_APP_URL` | frontend public URL |
| `RUN_WORKERS` | `true` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | for the seed (optional) |
| `TELEGRAM_BOT_TOKEN` | optional platform fallback bot |
| `REDIS_URL` | optional; without it a single‑process in‑memory shim is used |

(Check `backend/src/config/env.ts` for the authoritative list — boot fails fast if a required one is missing.)

**Frontend:**
| var | value |
|---|---|
| `NEXT_PUBLIC_API_URL` | backend public URL (build‑time) |

## 6. Post‑deploy checklist
- [ ] `GET https://<backend>/readyz` → `{"ok":true,"db":true}`
- [ ] Open frontend → log in (`admin@platform.local` / your `ADMIN_PASSWORD`).
- [ ] Settings → connect Binance key → **Test connection** shows your balance (confirms the region pin beat 451).
- [ ] Keep **Paper** mode on; **Start bot**; watch a paper trade + Telegram alert.
- [ ] Only switch to **Live** after a clean paper run.

## Notes
- The bot manager + WebSocket hub need a **persistent** process — don't use a host that sleeps on idle.
- Scale path: set `RUN_WORKERS=false` on the web service and run a separate `npm run worker` service; add `REDIS_URL` for multi‑replica locks.
