import {
  BILLING, PLAN_INFO, SubscriptionStatus, SubscriptionPlan, InvoiceStatus,
  canTrade as statusCanTrade, estimateInvoiceCents, centsToUsd,
} from '@platform/shared';
import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

/**
 * Subscription + usage billing engine.
 *
 *   Basic plan: $10/mo includes 150 trades, then $0.10 per extra trade.
 *   30-day free trial (one per user / email / mobile / Binance UID).
 *   On expiry → VIEW-ONLY: bot + signals disabled, no new trades, dashboard stays.
 *
 * (The old 1% profit-share fee was removed entirely.)
 */
const DAY = 86_400_000;

export const billingService = {
  /** Start the 30-day trial at registration. Enforces one-trial-per-identity. */
  async startTrial(userId: string, ident: { email: string; mobile?: string | null }) {
    const email = ident.email.toLowerCase();
    const mobile = ident.mobile?.trim() || null;
    const clash = await prisma.trialClaim.findFirst({
      where: { userId: { not: userId }, OR: [{ email }, ...(mobile ? [{ mobile }] : [])] },
    });
    if (clash) throw Errors.conflict('A free trial has already been used for this email or mobile number.');

    const now = new Date();
    const end = new Date(now.getTime() + BILLING.trialDays * DAY);
    await prisma.$transaction([
      prisma.trialClaim.upsert({
        where: { userId },
        create: { userId, email, mobile },
        update: { email, mobile },
      }),
      prisma.subscription.update({
        where: { userId },
        data: {
          plan: SubscriptionPlan.TRIAL, status: SubscriptionStatus.TRIALING,
          trialStartedAt: now, trialEndsAt: end,
          currentPeriodStart: now, currentPeriodEnd: end, tradesThisPeriod: 0,
          billingInterval: 'MONTH', paidUntil: end,
        },
      }),
    ]);
  },

  /**
   * Attach the Binance UID to the user's trial claim (best-effort dup-prevention).
   * If that UID already trialed under ANOTHER user, this account is blocked from
   * the free trial → moved to EXPIRED (must subscribe). Returns whether blocked.
   */
  async attachBinanceUid(userId: string, binanceUid: string | null | undefined): Promise<{ trialBlocked: boolean }> {
    if (!binanceUid) return { trialBlocked: false };
    const clash = await prisma.trialClaim.findFirst({ where: { binanceUid, userId: { not: userId } } });
    if (clash) {
      await prisma.subscription.update({
        where: { userId },
        data: { status: SubscriptionStatus.EXPIRED, plan: SubscriptionPlan.TRIAL },
      });
      logger.warn({ userId, binanceUid }, 'trial blocked: Binance UID already used a trial');
      return { trialBlocked: true };
    }
    await prisma.trialClaim.updateMany({ where: { userId }, data: { binanceUid } });
    return { trialBlocked: false };
  },

  /** Increment the monthly usage counter when a trade is OPENED. */
  async recordTradeOpened(userId: string) {
    await prisma.subscription.update({
      where: { userId }, data: { tradesThisPeriod: { increment: 1 } },
    }).catch(() => { /* subscription always exists; ignore races */ });
  },

  /**
   * Whether the bot may open NEW trades right now. Lazily flips an expired trial
   * to EXPIRED so the gate is self-healing without waiting for the cron.
   * ADMINs always pass — they get free, unlimited access (no subscription).
   */
  async canTradeNow(userId: string): Promise<boolean> {
    const sub = await prisma.subscription.findUnique({
      where: { userId }, include: { user: { select: { role: true } } },
    });
    if (!sub) return false;
    if (sub.user.role === 'ADMIN') return true; // admins: free full access
    // Paid-term gate (monthly for BASIC/trial, annual for PRO). Lazily expire.
    const term = sub.paidUntil ?? sub.trialEndsAt;
    if ((sub.status === SubscriptionStatus.TRIALING || sub.status === SubscriptionStatus.ACTIVE)
        && term && term < new Date()) {
      await prisma.subscription.update({ where: { userId }, data: { status: SubscriptionStatus.EXPIRED } });
      return false;
    }
    return statusCanTrade(sub.status);
  },

  /** Dashboard usage meter — the numbers the user sees. */
  async usageMeter(userId: string) {
    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { userId }, include: { user: { select: { role: true } } },
    });
    // ADMINs: free, unlimited, never view-only.
    if (sub.user.role === 'ADMIN') {
      return {
        plan: 'ADMIN', status: 'ACTIVE', tradesUsed: sub.tradesThisPeriod, includedTrades: 0,
        remainingIncludedTrades: 0, overageTrades: 0, estimatedInvoiceUsd: 0,
        monthlyPriceUsd: 0, overagePerTradeUsd: 0, nextBillingDate: null, trialEndsAt: null,
        inTrial: false, canTrade: true, viewOnly: false, unlimited: true,
      };
    }
    const used = sub.tradesThisPeriod;
    const discountPct = sub.nextInvoiceDiscountPct;
    const baseAfter = discountPct > 0 ? Math.round(sub.monthlyPriceCents * (100 - discountPct) / 100) : sub.monthlyPriceCents;
    // Per-trade overage fee removed — trades are UNLIMITED on the plan. Only the
    // subscription base is billed (still discountable by a coupon).
    const estCents = baseAfter;
    const inTrial = sub.status === SubscriptionStatus.TRIALING;
    const info = PLAN_INFO[sub.plan as keyof typeof PLAN_INFO] ?? PLAN_INFO.BASIC;
    return {
      plan: sub.plan,
      status: sub.status,
      billingInterval: sub.billingInterval,            // MONTH | YEAR
      tradesUsed: used,
      includedTrades: sub.includedTrades,              // shown for reference; not a billing cap anymore
      remainingIncludedTrades: 0,
      overageTrades: 0,
      estimatedInvoiceUsd: inTrial ? 0 : centsToUsd(estCents), // next invoice = subscription only
      monthlyPriceUsd: centsToUsd(sub.monthlyPriceCents),
      planPriceUsd: centsToUsd(info.termCents),        // 10 (BASIC/mo) or 100 (PRO/yr)
      overagePerTradeUsd: 0,                           // no per-trade fee
      unlimitedTrades: true,                           // trades are unlimited on the plan
      nextBillingDate: sub.currentPeriodEnd,           // monthly billing cycle end
      renewalDate: sub.paidUntil,                      // when the paid term renews (annual for PRO)
      trialEndsAt: sub.trialEndsAt,
      inTrial,
      nextInvoiceDiscountPct: discountPct,             // pending one-time coupon discount
      canTrade: statusCanTrade(sub.status),
      viewOnly: !statusCanTrade(sub.status),
    };
  },

  /**
   * Subscribe / renew. BASIC = $10/mo (30-day term). PRO = $100/yr (365-day term,
   * 2 months free) — both include 150 trades PER MONTH, $0.10/overage. The monthly
   * usage window resets every 30 days regardless of plan. Payment provider stubbed.
   */
  async subscribe(userId: string, plan: 'BASIC' | 'PRO' = 'BASIC') {
    const info = PLAN_INFO[plan];
    const now = new Date();
    const usageEnd = new Date(now.getTime() + 30 * DAY);              // monthly allowance window
    const paidUntil = new Date(now.getTime() + info.termDays * DAY);  // access term (annual for PRO)

    // Consume any one-time coupon discount against this term charge.
    const cur = await prisma.subscription.findUniqueOrThrow({ where: { userId }, select: { nextInvoiceDiscountPct: true } });
    const discountPct = cur.nextInvoiceDiscountPct;
    const termCents = discountPct > 0 ? Math.round(info.termCents * (100 - discountPct) / 100) : info.termCents;

    await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({
        where: { userId },
        data: {
          plan, status: SubscriptionStatus.ACTIVE,
          billingInterval: info.interval,
          monthlyPriceCents: info.monthlyBaseCents, // BASIC 1000 (monthly base) · PRO 0 (overage-only monthly)
          currentPeriodStart: now, currentPeriodEnd: usageEnd, tradesThisPeriod: 0,
          paidUntil,
          nextInvoiceDiscountPct: 0, // one-time discount consumed
        },
      });
      // Charge the term up-front (payment provider stubbed → record a PAID invoice).
      if (info.termCents > 0) {
        await tx.usageInvoice.create({
          data: {
            userId, subscriptionId: sub.id, periodStart: now, periodEnd: paidUntil,
            tradesCount: 0, includedTrades: sub.includedTrades, overageTrades: 0,
            baseCents: termCents, overageCents: 0, totalCents: termCents,
            status: InvoiceStatus.PAID, paidAt: now, provider: 'stub',
          },
        });
      }
    });
    await prisma.auditLog.create({ data: { userId, action: 'SUBSCRIBE', metadata: { plan, discountPct } } });
    return this.usageMeter(userId);
  },

  /**
   * Close the current period: emit a UsageInvoice, reset the counter, advance the
   * period. Called by the monthly billing worker. If the new period isn't paid,
   * the provider webhook (phase 2) flips ACTIVE→PAST_DUE→EXPIRED.
   */
  async closePeriodAndInvoice(userId: string) {
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd) return null;

    const overage = Math.max(0, sub.tradesThisPeriod - sub.includedTrades); // informational only
    const wasTrial = sub.status === SubscriptionStatus.TRIALING;
    const discountPct = sub.nextInvoiceDiscountPct;
    // Per-trade overage fee removed — trades are unlimited; bill ONLY the subscription
    // base (coupon-discountable). Trial periods are free regardless.
    const baseCents = wasTrial ? 0
      : (discountPct > 0 ? Math.round(sub.monthlyPriceCents * (100 - discountPct) / 100) : sub.monthlyPriceCents);
    const billedOverage = 0;
    const totalCents = baseCents + billedOverage;

    const now = new Date();
    const nextEnd = new Date(now.getTime() + 30 * DAY);
    // BASIC renews access monthly (stub auto-renew); PRO's annual term is untouched here.
    const extendTerm = sub.billingInterval === 'MONTH' ? { paidUntil: nextEnd } : {};

    const [, invoice] = await prisma.$transaction([
      prisma.subscription.update({
        where: { userId },
        data: { currentPeriodStart: now, currentPeriodEnd: nextEnd, tradesThisPeriod: 0,
                nextInvoiceDiscountPct: 0, ...extendTerm }, // consume one-time discount
      }),
      prisma.usageInvoice.create({
        data: {
          userId, subscriptionId: sub.id,
          periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd,
          tradesCount: sub.tradesThisPeriod, includedTrades: sub.includedTrades,
          overageTrades: overage,
          baseCents, overageCents: billedOverage, totalCents,
          status: wasTrial ? InvoiceStatus.PAID : InvoiceStatus.OPEN,
          paidAt: wasTrial ? now : null,
        },
      }),
    ]);
    logger.info({ userId, totalCents: invoice.totalCents, discountPct }, 'usage invoice generated');
    return invoice;
  },

  listInvoices(userId: string) {
    return prisma.usageInvoice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  },

  /** Admin: platform revenue snapshot for the CRM. */
  async revenueSnapshot() {
    const [activeSubs, basicActive, proActive, trialing, pastDue] = await Promise.all([
      prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE, plan: SubscriptionPlan.BASIC } }),
      prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE, plan: SubscriptionPlan.PRO } }),
      prisma.subscription.count({ where: { status: SubscriptionStatus.TRIALING } }),
      prisma.subscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
    ]);
    const paid = await prisma.usageInvoice.aggregate({ where: { status: InvoiceStatus.PAID }, _sum: { totalCents: true } });
    const open = await prisma.usageInvoice.aggregate({ where: { status: InvoiceStatus.OPEN }, _sum: { totalCents: true } });
    // Normalized monthly recurring revenue: BASIC $10/mo + PRO $100/yr ÷ 12.
    const mrrCents = basicActive * BILLING.basicMonthlyCents + proActive * Math.round(BILLING.proAnnualCents / 12);
    return {
      activeSubscriptions: activeSubs,
      basicSubscriptions: basicActive,
      proSubscriptions: proActive,
      trialingUsers: trialing,
      pastDueUsers: pastDue,
      mrrUsd: centsToUsd(mrrCents), // base MRR (excludes overage)
      collectedRevenueUsd: centsToUsd(paid._sum.totalCents ?? 0),
      outstandingRevenueUsd: centsToUsd(open._sum.totalCents ?? 0),
    };
  },
};

void estimateInvoiceCents; // exported helper available to the frontend/shared
