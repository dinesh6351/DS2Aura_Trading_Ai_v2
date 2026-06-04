# 04 · Security Checklist

A live-money, multi-tenant system. Treat every item as required before onboarding real users.

## Secrets & key management
- [x] **API keys encrypted at rest** — AES-256-GCM (`lib/crypto.ts`), `{cipher,iv,tag}` stored separately.
- [x] **Plaintext keys never leave the engine** — decrypted only at tick time, never returned/logged.
- [x] **Log redaction** — `lib/logger.ts` censors authorization, cookies, `*.secret`, `*.password`, tokens.
- [ ] **Encryption-key rotation** — re-encrypt with new `API_KEY_ENC_KEY` via a migration job; keep a `keyVersion` column for zero-downtime rotation. *(designed, implement before scale)*
- [x] **Withdrawal-permission warning** — onboarding flags any key with `canWithdraw=true` (a key should be trade-only).
- [ ] Store `API_KEY_ENC_KEY` / JWT secrets in a managed secret store (Railway/Vercel/Supabase vault), never in git.

## Authentication & sessions
- [x] **Argon2** password hashing.
- [x] **Short access tokens (15m) + rotating refresh tokens (30d)**; refresh hash stored per-session.
- [x] **Refresh-token reuse detection** → session revoked on replay (theft mitigation).
- [x] **httpOnly + Secure + SameSite cookie** for the refresh token (XSS can't read it).
- [x] **Access token in memory only** on the frontend (not localStorage).
- [x] **2FA (TOTP)** with encrypted secret + ±30s window.
- [x] **Brute-force limiter** on auth routes (10 / 15 min).
- [ ] Email verification + password-reset flows wired to the email provider. *(routes/tokens stubbed)*

## Multi-tenant isolation
- [x] Acting `userId` taken **only** from JWT `sub` — never from client input.
- [x] All tenant queries scoped by `userId`; cross-tenant reads only behind admin RBAC.
- [ ] **Postgres RLS** policies enabled on Supabase (defence-in-depth) — see `02-database-schema.md`.

## Access control
- [x] **RBAC** roles: ADMIN / MANAGER / SUPPORT / TRADER (`middleware/rbac.ts`); ADMIN passes all.
- [x] Privileged actions are role-gated (force-close/waive = ADMIN/MANAGER/ADMIN).
- [x] **Admin actions audited** (`admin_logs`: who/whom/what/why).

## Network & transport
- [x] **helmet** security headers; **CORS** locked to `PUBLIC_APP_URL` with credentials.
- [x] `trust proxy` set so rate-limit sees real client IP behind Railway/Vercel.
- [x] Body size cap (256 kb) to blunt payload abuse.
- [ ] WAF / DDoS: front with Cloudflare (free tier) in production.

## Exchange & rate limits
- [x] **-1003 circuit breaker** — ban expiry persisted; *all* calls refused until it clears (blocked-but-attempted calls extend the ban).
- [x] **TTL cache** on public data (klines 3s, funding 60s); shared market status (60s) → 1 fetch for all tenants.
- [x] **Per-user tick lock** prevents duplicate orders across worker replicas.
- [x] **Software watchdog** enforces SL/TP/break-even/trailing even when exchange stops are rejected (-4120).

## Data & money integrity
- [x] Money as **Decimal**, not float.
- [x] Fee accrual + wallet update + trade update in a **single transaction**.
- [ ] Daily reconciliation job: bot's `positions`/`trade_history` vs Binance source of truth.

## Operational
- [x] Health/readiness endpoints for the platform's uptime checks.
- [ ] **Sentry** error tracking + **PostHog** analytics (DSNs in env).
- [ ] Backups: Supabase PITR enabled; test a restore.
- [ ] Incident runbook: revoke-all-sessions, force-stop-all-bots, rotate keys.

## Compliance posture (before charging fees)
- [ ] Terms of Service + risk disclaimer (trading loses money; bot is not financial advice).
- [ ] KYC fields exist (`profiles.kycStatus/kycData`) — wire a provider if your jurisdiction requires it.
- [ ] Clear pricing disclosure ($10/mo, 150 trades included, $0.10/overage, 30-day trial) at onboarding + in the billing/usage page.
```
