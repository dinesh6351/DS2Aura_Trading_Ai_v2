# 06 · Production Roadmap

Phased plan from the current foundation to a 10k-user platform. Each phase is shippable.

## Phase 0 — Foundation ✅ (this delivery)
- Monorepo (backend/frontend/shared), 19-table schema, secure core (env, crypto, prisma, logger).
- Auth (JWT + refresh rotation + 2FA + sessions), RBAC.
- Per-tenant Binance client + ported 19-condition strategy + multi-tenant orchestrator + watchdog.
- Subscription billing ($10/mo + 150 trades + $0.10 overage, 30-day trial, view-only on expiry, usage meter), Admin CRM, realtime WS, dashboards, onboarding, chart page.
- Full docs (architecture, schema, API, security, deploy, roadmap) + feature-parity matrix.

## Phase 1 — MVP hardening (1–2 weeks) → onboard ~10 trusted users
- [ ] Fill the 🟡 stubs in `00-feature-parity.md`: liquidity-sweep/breakout detectors, per-symbol
      loss cooldown, leverage-bracket cap, balance-aware sizing toggle, spread gate via order-book depth.
- [ ] Email verification + password reset (provider wired).
- [ ] Per-symbol `exchangeInfo` (stepSize/tickSize) for exact qty/price rounding (replace `roundQty`).
- [ ] Reconciliation job (DB positions vs Binance) + orphan cleanup.
- [ ] Frontend: settings page (config form with live preview), billing/invoices page, sessions page,
      Trader Performance panel + trade-detail modal, notifications bell.
- [ ] Sentry + PostHog wired; structured request logging dashboards.
- [ ] Testnet end-to-end test; then your own live account as user #1.

## Phase 2 — Public beta (2–4 weeks) → ~100 users
- [ ] Redis: rate-limit store + bot locks + realtime fan-out; split web/worker services.
- [ ] Postgres RLS policies on Supabase.
- [ ] Payment provider (Stripe / Razorpay / Binance Pay) to actually charge the monthly
      `usage_invoices` (`closePeriodAndInvoice` → charge); card on file at subscribe; dunning + auto
      `ACTIVE→PAST_DUE→EXPIRED` on failed payment.
- [ ] Wire **mobile (SMS/OTP) verification** + **Binance UID capture** to fully enforce the
      one-trial-per-identity rule (email + mobile already enforced; UID hook is in `TrialClaim`).
- [ ] Additional plans / annual pricing with feature gating (the model is per-user overridable).
- [ ] Support tickets UI + admin assignment; broadcast composer.
- [ ] Terms of Service, risk disclaimer, pricing disclosure ($10/mo + overage); basic KYC capture.
- [ ] Load test the worker sweep at 100 running bots; tune `CONCURRENCY`/interval.

## Phase 3 — Scale (1–2 months) → 1k users
- [ ] Move bot ticks to a **job queue** (BullMQ/Redis): one job per user, autoscaled workers.
- [ ] Postgres read-replica + PgBouncer; partition `positions`/`trade_history` by month.
- [ ] Realtime to Supabase Realtime (or dedicated WS tier) for fan-out beyond one process.
- [ ] Per-tenant Telegram bot tokens + email digests.
- [ ] Real-time per-symbol WebSocket klines/user-data (the `bot-live.js` upgrade) for ~1s reaction.
- [ ] Encryption-key rotation with `keyVersion`; secret-store integration.
- [ ] Admin analytics: cohort retention, revenue charts, churn, risk heatmap.

## Phase 4 — Platform (3–6 months) → 10k+ users
- [ ] Multi-exchange (Bybit/OKX) via an exchange-adapter interface behind `BinanceClient`.
- [ ] Strategy marketplace / custom strategy builder (config-driven, sandboxed).
- [ ] Mobile apps (React Native + Expo) on the same REST/WS API (PWA already supported).
- [ ] Regional worker pools to spread Binance egress IPs (sidesteps 451 at scale).
- [ ] SOC2-style controls: access reviews, audit exports, pen-test, bug bounty.
- [ ] Data warehouse (BigQuery/Snowflake) for analytics; ETL from Postgres.

## Cross-cutting (every phase)
- Keep `runSafetyCheck` parity with any strategy improvements you make in `claude-execute` (or make
  the SaaS the source of truth and back-port).
- Paper/testnet-gate every strategy change before it touches live tenant funds.
- Track **net P&L over 100+ trades**, not single trades — same discipline as the original bot.

## Suggested team & cost as you grow
| Stage | Infra/mo | Team |
|---|---|---|
| MVP (≤10) | ~$0–10 (free tiers) | you |
| Beta (≤100) | ~$20–50 (Railway + Supabase paid tiers + Redis) | you + 1 |
| Scale (1k) | ~$200–500 | +backend, +support |
| Platform (10k) | $2k+ | +SRE, +compliance |
```
