# 03 · API Documentation

Base URL: `${API}/api`. All responses use the envelope:

```json
{ "ok": true, "data": <T> }              // success
{ "ok": false, "error": { "code": "…", "message": "…", "details": … } }   // failure
```

Auth: send `Authorization: Bearer <accessToken>`. Access tokens last 15 min; refresh via the
httpOnly cookie at `POST /api/auth/refresh`. Rate limits: 120 req/min/IP (`/api`), 10/15min on auth.

---

## Auth — `/api/auth`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `{email,password,fullName,mobile?,country?}` | creates user + profile + wallet + default bot/watchlist; returns `{user, accessToken}`, sets refresh cookie |
| POST | `/login` | `{email,password,totp?}` | `needs2fa:true` in error details if 2FA required |
| POST | `/refresh` | — (cookie) | rotates refresh token, returns new access token |
| POST | `/logout` | — | revokes current session |
| POST | `/2fa/setup` | — | returns `{otpauthUrl, secret}` for QR |
| POST | `/2fa/confirm` | `{code}` | enables 2FA |

## Me / Users — `/api`

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | user + profile + subscription + botConfig |
| PATCH | `/me/profile` | `{fullName?,mobile?,country?,timezone?}` |
| GET | `/me/sessions` | device/login history; `current:true` flags this session |
| DELETE | `/me/sessions/:id` | revoke a device |
| GET | `/me/notifications` · POST `/me/notifications/read` | in-app notifications |
| GET | `/me/audit` | the user's own security log |

## API keys — `/api/apikeys`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/` | `{apiKey,secret,label?}` | validated vs Binance, stored **encrypted**; returns withdrawal warning if enabled |
| GET | `/` | — | masked metadata only (never ciphertext/plaintext) |
| DELETE | `/:id` | — | revoke key + stop bot |

## Bot — `/api/bot`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/status` | — | full BotConfig + runtime state |
| POST | `/start` | — | requires a VALID trade-enabled key |
| POST | `/pause` · `/stop` | — | |
| POST | `/mode` | `{mode: CONSERVATIVE\|BALANCED\|AGGRESSIVE}` | applies risk preset |
| PATCH | `/config` | any of `scoreThreshold,leverage,marginPerTradeUsd,slPercent,tpRR,maxConcurrentPositions,maxTradesPerDay,lossCooldownMin,marginGuardPct,use*` | live tuning, no code change |
| GET | `/log` | — | recent bot activity |

## Trading data — `/api/trading`

| Method | Path | Notes |
|---|---|---|
| GET | `/account` | balance, available, margin, open count |
| GET | `/positions` | open positions |
| GET | `/trades` | trade history |
| GET | `/stats` | win rate, ROI, today/weekly/monthly P&L |
| GET | `/pnl/history` | daily equity points for the chart |
| GET | `/performance` | per-coin Trader Performance Analysis |
| GET | `/trade-detail?symbol=` | round-trips + rule-based analysis |
| GET | `/market-status` | shared BTC trend / verdict / F&G / funding |
| GET | `/chart-detail?symbol=` | AI trade plan + multi-TF S/R + multi-TF bias |
| GET | `/watchlist` · PUT `/watchlist` | `{symbols:[…]}` |
| GET | `/export/trades.csv` | tax-ready CSV download |

## Billing — `/api/billing` (subscription model)

Basic plan: **$10/mo includes 150 trades, then $0.10/extra trade**; 30-day free trial; view-only on expiry.

| Method | Path | Notes |
|---|---|---|
| GET | `/usage` | the dashboard **usage meter**: `tradesUsed/includedTrades`, `remainingIncludedTrades`, `overageTrades`, `estimatedInvoiceUsd`, `status`, `nextBillingDate`, `trialEndsAt`, `inTrial`, `viewOnly` |
| GET | `/subscription` | raw subscription record (plan, status, period, counters) |
| GET | `/invoices` | monthly usage-invoice history |
| POST | `/subscribe` | start/renew the Basic plan for a 30-day period (payment provider stubbed) |

## Admin CRM — `/api/admin` (ADMIN/MANAGER/SUPPORT)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/overview` | staff | platform metrics: users, **active subs / trials / past-due, MRR, collected & outstanding revenue**, volume, ban state |
| GET | `/users?search=&limit=&offset=` | staff | paginated user list |
| GET | `/leaderboard?order=top\|worst` | staff | top/worst traders |
| GET | `/audit-logs?userId=` | staff | user security trail |
| GET | `/admin-logs` | admin/mgr | privileged-action trail |
| POST | `/users/:id/status` | admin/mgr | `{status,reason}` enable/suspend/disable |
| POST | `/users/:id/bot` | admin/mgr | `{action: PAUSE\|RESUME\|STOP}` |
| POST | `/users/:id/force-close` | admin/mgr | `{positionId,reason}` emergency close (user's keys) |
| POST | `/users/:id/grant-subscription` | admin | comp a free month of Basic (no charge) |
| POST | `/broadcast` | admin/mgr | `{title,body}` notify all active users |

## Realtime — `WSS /ws?token=<accessToken>`

Subscribe: `{ "type":"subscribe", "channel":"user:<id>:positions" }`. A socket may only join its
own `user:<id>:*` channels (server refuses others). Channels: `:positions`, `:pnl`, `:botlog`,
`:signals`, plus `admin:feed` (admin role).

## Health

`GET /healthz` (liveness) · `GET /readyz` (DB check + Binance ban state).
