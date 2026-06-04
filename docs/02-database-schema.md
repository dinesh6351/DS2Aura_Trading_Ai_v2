# 02 · Database Schema

PostgreSQL via Prisma. Source of truth: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).
**19 core tables**, multi-tenant. Money is `Decimal` (never float).

## Tables

| # | Table | Purpose | Tenant key |
|---|---|---|---|
| 1 | `users` | identity, role, status, 2FA | — (root) |
| 2 | `profiles` | name/mobile/country/KYC | `userId` 1:1 |
| 3 | `subscriptions` | plan, status, **billing period, trial dates, usage counter**, pricing (cents), provider ids | `userId` 1:1 |
| 4 | `api_keys` | **encrypted** Binance creds + validation cache | `userId` 1:N |
| 5 | `trading_accounts` | balance snapshot synced from Binance | `userId` 1:N |
| 6 | `watchlists` | per-user symbols | `userId` 1:N |
| 7 | `bot_configs` | strategy + risk settings + runtime state | `userId` 1:1 |
| 8 | `positions` | open/closed positions (mirror of exchange) | `userId` 1:N |
| 9 | `trade_history` | completed round-trips, tax-ready, fee fields | `userId` 1:N |
| 10 | `pnl_history` | daily aggregates for charts/ROI | `userId` 1:N |
| 11 | `usage_invoices` | **monthly subscription + per-trade overage invoices** | `userId` 1:N |
| 12 | `wallets` | per-user lifetime trading P&L (platform takes no cut) | `userId` 1:1 |
| 12b | `trial_claims` | one-trial-per email/mobile/Binance-UID (unique) | `userId` 1:1 |
| 13 | `transactions` | money movements (fee charge, subscription) | `userId` 1:N |
| 14 | `notifications` | in-app/email/telegram | `userId` 1:N |
| 15 | `support_tickets` | CRM tickets | `userId` 1:N |
| 16 | `audit_logs` | user-facing security trail | `userId` 1:N |
| 17 | `admin_logs` | privileged-action trail | `adminId` |
| 18 | `system_settings` | platform-wide KV | — |
| 19 | `sessions` | refresh-token rotation / device mgmt | `userId` 1:N |

## Key relationships

```
User 1─1 Profile, Subscription, Wallet, BotConfig, TradingAccount(default)
User 1─1 TrialClaim
User 1─N ApiKey, Watchlist, Position, TradeHistory, PnlHistory, UsageInvoice,
          Transaction, Notification, SupportTicket, AuditLog, Session
Subscription 1─N UsageInvoice   (one invoice per billing period)
```

## Indexing strategy

- Every tenant table is indexed on `userId` (and `userId+status` / `userId+date` where filtered).
- `usage_invoices(status)`, `subscriptions(status)`, `subscriptions(currentPeriodEnd)`, `bot_configs(status)` for the worker/admin scans.
- `pnl_history(userId,date)` and `trial_claims(email|mobile|binanceUid)` carry unique constraints (idempotent aggregates + one-trial-per-identity).

## Money & precision

- USDT amounts: `Decimal(38,18)` (prices/qty) or `Decimal(18,8)` (fees/margin).
- Always wrap with `Number()` only at the read/serialization boundary; do arithmetic on Decimals or
  fixed-point integers when correctness matters (fee math uses `bps/10_000` then `toFixed(8)`).

## Row-Level Security (Supabase) — recommended

When hosted on Supabase, enable RLS as a belt-and-suspenders layer behind the app's query scoping:

```sql
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON positions
  USING (user_id = auth.uid());          -- read
-- repeat for every tenant table; service-role key bypasses RLS for the worker/admin.
```

The Express backend connects with the **service role** (trusted, does its own scoping); a future
direct-from-browser Supabase path would rely on RLS. Keep both.

## Migrations

```bash
npm run db:migrate        # dev: create + apply a migration
npm run db:deploy         # prod: apply committed migrations (CI/CD)
npm run db:seed           # create the initial ADMIN user
```
