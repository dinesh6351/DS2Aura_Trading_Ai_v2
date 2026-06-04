/**
 * Shared types & enums used by both backend and frontend.
 * Keep this provider-agnostic and free of runtime dependencies so it can be
 * imported safely from React Server Components and the Express API alike.
 */

// ---------------------------------------------------------------------------
// Roles & access control
//
// NOTE: these are declared as `const object + union type` (NOT TS `enum`) on
// purpose. Prisma generates its enums in exactly this shape, so the two are
// mutually assignable — a `Role` from the DB can flow into a JWT claim and back
// with zero casting. TS string `enum`s are opaque and would break that interop.
// ---------------------------------------------------------------------------
export const Role = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  SUPPORT: 'SUPPORT',
  TRADER: 'TRADER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Coarse capability map used by the RBAC middleware and the frontend nav guard. */
export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  [Role.ADMIN]: ['*'],
  [Role.MANAGER]: ['users:read', 'users:write', 'bots:control', 'fees:read', 'broadcast'],
  [Role.SUPPORT]: ['users:read', 'tickets:write', 'audit:read'],
  [Role.TRADER]: ['self:read', 'self:write', 'bot:self'],
};

// ---------------------------------------------------------------------------
// Trading domain (const-object + union, Prisma-compatible — see Role note above)
// ---------------------------------------------------------------------------
export const TradingMode = {
  CONSERVATIVE: 'CONSERVATIVE',
  BALANCED: 'BALANCED',
  AGGRESSIVE: 'AGGRESSIVE',
} as const;
export type TradingMode = (typeof TradingMode)[keyof typeof TradingMode];

export const BotStatus = {
  STOPPED: 'STOPPED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR',
} as const;
export type BotStatus = (typeof BotStatus)[keyof typeof BotStatus];

export const PositionSide = {
  LONG: 'LONG',
  SHORT: 'SHORT',
} as const;
export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide];

export const PositionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  LIQUIDATED: 'LIQUIDATED',
} as const;
export type PositionStatus = (typeof PositionStatus)[keyof typeof PositionStatus];

export const SubscriptionPlan = {
  TRIAL: 'TRIAL',
  BASIC: 'BASIC',
  PRO: 'PRO',
} as const;
export type SubscriptionPlan = (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan];

export const SubscriptionStatus = {
  TRIALING: 'TRIALING',   // in 30-day free trial, full access
  ACTIVE: 'ACTIVE',       // paid, full access
  PAST_DUE: 'PAST_DUE',   // payment failed, in grace window
  EXPIRED: 'EXPIRED',     // trial ended / grace passed → VIEW-ONLY
  CANCELED: 'CANCELED',   // user canceled → VIEW-ONLY at period end
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/** Whether a subscription status permits the bot to open NEW trades. */
export function canTrade(status: SubscriptionStatus): boolean {
  return status === SubscriptionStatus.TRIALING || status === SubscriptionStatus.ACTIVE;
}

export const InvoiceStatus = {
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

/**
 * Billing model — Basic plan: $10/mo includes 150 trades, then $0.10 per extra
 * trade, billed monthly. 30-day free trial. All money in integer CENTS to avoid
 * float drift. (The old 1% profit-share fee was removed.)
 */
export const BILLING = {
  basicMonthlyCents: 1000,      // $10.00 / month
  proAnnualCents: 10_000,       // $100.00 / year (= 10 months → 2 months free)
  proMonthsFree: 2,
  includedTrades: 150,          // trades included PER MONTH (both paid plans)
  overagePerTradeCents: 10,     // $0.10 per trade beyond the included amount
  trialDays: 30,                // free-trial length
  pastDueGraceDays: 3,          // grace after a failed payment before EXPIRED
} as const;

/**
 * Per-plan economics. The usage/allowance window is ALWAYS monthly (150 trades
 * reset every 30 days). `monthlyBaseCents` is the base added to each monthly
 * usage invoice. `termCents`/`termDays` is the recurring access charge:
 *   - BASIC bills monthly ($10 every 30 days; base IS the term charge).
 *   - PRO  bills annually ($100 every 365 days; monthly invoices are overage-only).
 */
export const PLAN_INFO: Record<SubscriptionPlan, {
  interval: 'MONTH' | 'YEAR'; monthlyBaseCents: number; termCents: number; termDays: number;
}> = {
  TRIAL: { interval: 'MONTH', monthlyBaseCents: 0,    termCents: 0,      termDays: 30 },
  BASIC: { interval: 'MONTH', monthlyBaseCents: 1000, termCents: 1000,   termDays: 30 },
  PRO:   { interval: 'YEAR',  monthlyBaseCents: 0,    termCents: 10_000, termDays: 365 },
};

/** Projected monthly invoice (cents) for a trade count, given the plan's monthly base. */
export function estimateInvoiceCents(tradesThisPeriod: number, monthlyBaseCents = BILLING.basicMonthlyCents): number {
  const overage = Math.max(0, tradesThisPeriod - BILLING.includedTrades);
  return monthlyBaseCents + overage * BILLING.overagePerTradeCents;
}

export const centsToUsd = (c: number): number => Math.round(c) / 100;

/**
 * Risk presets that map a TradingMode onto concrete bot-config values.
 * The bot engine reads the resolved BotConfig; these are just the defaults the
 * onboarding flow seeds when a user picks a mode.
 */
export const MODE_PRESETS: Record<TradingMode, {
  scoreThreshold: number;
  leverage: number;
  marginPerTradeUsd: number;
  slPercent: number;
  tpRR: number;
  maxConcurrentPositions: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  lossCooldownMin: number;
}> = {
  // NB: thresholds are calibrated for the 24-condition trend-pullback engine — a
  // normalised score (earned/available × 100) where ~80% agreement across a
  // small, category-diverse confluence set is a strong, selective setup. (The
  // 76/70/64 values belonged to the ~50-condition expansion, which scored high
  // only at exhaustion tops and was reverted.)
  [TradingMode.CONSERVATIVE]: {
    scoreThreshold: 88, leverage: 5, marginPerTradeUsd: 5, slPercent: 1, tpRR: 3,
    maxConcurrentPositions: 1, maxTradesPerDay: 4, maxConsecutiveLosses: 3, lossCooldownMin: 45,
  },
  [TradingMode.BALANCED]: {
    scoreThreshold: 85, leverage: 10, marginPerTradeUsd: 5, slPercent: 1, tpRR: 3,
    maxConcurrentPositions: 3, maxTradesPerDay: 6, maxConsecutiveLosses: 3, lossCooldownMin: 30,
  },
  [TradingMode.AGGRESSIVE]: {
    scoreThreshold: 80, leverage: 15, marginPerTradeUsd: 5, slPercent: 1.2, tpRR: 5,
    maxConcurrentPositions: 5, maxTradesPerDay: 12, maxConsecutiveLosses: 3, lossCooldownMin: 15,
  },
};

/**
 * Dynamic profit-protection ladder (price-move fractions). As an open trade runs
 * into profit, the stop is ratcheted up to the `lock` level for the highest
 * `trigger` reached — and NEVER moves back. The trade rides to PROFIT_TAKE_CAP
 * then auto-closes. Shared so the engine watchdog and the dashboard card use the
 * exact same numbers. Initial stop = the user's slPercent (e.g. -1%).
 */
export const PROFIT_LADDER: { trigger: number; lock: number }[] = [
  // Professional trail: arm at +0.5% locking just above break-even (clears the
  // ~0.08% round-trip fee), then trail ~0.5% behind as the move runs — wide
  // enough that normal noise doesn't stop you out, tight enough to bank gains.
  { trigger: 0.005, lock: 0.001 }, // +0.5% → lock +0.1%  (break-even+ — past here the trade can't turn into a loss; 0.4% room)
  { trigger: 0.010, lock: 0.005 }, // +1.0% → lock +0.5%
  { trigger: 0.015, lock: 0.010 }, // +1.5% → lock +1.0%
  { trigger: 0.020, lock: 0.015 }, // +2.0% → lock +1.5%
  { trigger: 0.025, lock: 0.020 }, // +2.5% → lock +2.0%
  { trigger: 0.030, lock: 0.025 }, // +3.0% → lock +2.5%
  { trigger: 0.040, lock: 0.035 }, // +4.0% → lock +3.5%
];
export const PROFIT_TAKE_CAP = 0.05; // +5% → take profit (close)
export const MIN_RISK_REWARD = 3;    // reject setups below 1:3

/**
 * Scaled take-profit ladder derived from the user's risk config. All level values
 * are PRICE-MOVE FRACTIONS from entry (e.g. 0.006 = +0.6%); the *SizePct values are
 * percentages of the original position. SHARED by the engine watchdog and the
 * Settings ladder preview so the two never drift.
 *   - TP1 (tp1Pct): book tp1SizePct% and move the stop to break-even.
 *   - TP2 (slPct × RR × tp2Frac): book tp2SizePct%.
 *   - TP3 / runner: the remaining runnerSizePct% trails to the full RR target
 *     (slPct × RR), capped at PROFIT_TAKE_CAP.
 */
export interface TpLadder {
  tp1: number; tp1SizePct: number;
  tp2: number; tp2SizePct: number;
  tp3: number; runnerSizePct: number;
}
export function tpLadder(cfg: {
  slPercent: number; tpRR: number;
  tp1Pct: number; tp1SizePct: number; tp2Frac: number; tp2SizePct: number;
}): TpLadder {
  const slFrac = cfg.slPercent / 100;
  const tp3 = Math.min(slFrac * cfg.tpRR, PROFIT_TAKE_CAP); // full RR target, capped at +5%
  const tp1 = cfg.tp1Pct / 100;
  const tp2 = Math.min(tp3, Math.max(tp1, tp3 * cfg.tp2Frac)); // between TP1 and the full target
  const runnerSizePct = Math.max(0, 100 - cfg.tp1SizePct - cfg.tp2SizePct);
  return { tp1, tp1SizePct: cfg.tp1SizePct, tp2, tp2SizePct: cfg.tp2SizePct, tp3, runnerSizePct };
}
// Binance USDT-M taker fee (0.04% per side). Subtracted from every closed trade
// so recorded P&L matches the real wallet instead of showing a thin paper win.
export const TAKER_FEE_RATE = 0.0004;

// Regions for the signup/profile timezone dropdown. `tz` is an IANA zone used to
// compute each user's local "today" (P&L, trade count, daily reset). DST-aware.
export const REGIONS: { tz: string; label: string }[] = [
  { tz: 'Asia/Kolkata', label: 'India — IST (UTC+5:30)' },
  { tz: 'UTC', label: 'UTC' },
  { tz: 'America/New_York', label: 'US — Eastern (ET)' },
  { tz: 'America/Chicago', label: 'US — Central (CT)' },
  { tz: 'America/Denver', label: 'US — Mountain (MT)' },
  { tz: 'America/Los_Angeles', label: 'US — Pacific (PT)' },
  { tz: 'Europe/London', label: 'UK — London (GMT/BST)' },
  { tz: 'Europe/Paris', label: 'Europe — Central (CET)' },
  { tz: 'Asia/Dubai', label: 'UAE — Dubai (UTC+4)' },
  { tz: 'Asia/Singapore', label: 'Singapore (UTC+8)' },
  { tz: 'Asia/Shanghai', label: 'China (UTC+8)' },
  { tz: 'Asia/Tokyo', label: 'Japan — Tokyo (UTC+9)' },
  { tz: 'Australia/Sydney', label: 'Australia — Sydney (AET)' },
];
export const REGION_TZS = new Set(REGIONS.map((r) => r.tz));
export const regionLabel = (tz?: string | null): string =>
  REGIONS.find((r) => r.tz === tz)?.label ?? (tz || 'UTC');

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------
export interface ApiOk<T> { ok: true; data: T; }
export interface ApiErr { ok: false; error: { code: string; message: string; details?: unknown }; }
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds for the access token
}

export interface JwtClaims {
  sub: string;      // user id
  role: Role;
  sid: string;      // session id (for refresh-token rotation / revocation)
  iat?: number;
  exp?: number;
}

// ---------------------------------------------------------------------------
// Realtime channel names (Supabase Realtime / WS)
// ---------------------------------------------------------------------------
export const CHANNELS = {
  userPositions: (userId: string) => `user:${userId}:positions`,
  userPnl: (userId: string) => `user:${userId}:pnl`,
  userBotLog: (userId: string) => `user:${userId}:botlog`,
  userSignals: (userId: string) => `user:${userId}:signals`,
  adminFeed: () => `admin:feed`,
} as const;
