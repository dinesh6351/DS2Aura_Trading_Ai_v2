import type { Coupon } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../lib/http.js';

/**
 * Coupons: admin-created discount codes (or direct grants) that apply a ONE-TIME
 * percentage discount to a user's NEXT invoice. The pending discount lives on
 * `Subscription.nextInvoiceDiscountPct` and is consumed (reset to 0) by the
 * billing engine the next time it charges (see billing.service.ts).
 *
 *  - Admin can create reusable codes AND apply a coupon straight to a user.
 *  - Users can redeem a code themselves.
 *  - Any percent 1–100 (100 = free). One redemption per coupon per user.
 */

const norm = (code: string) => code.trim().toUpperCase();

function assertUsable(c: Pick<Coupon, 'active' | 'expiresAt' | 'maxRedemptions' | 'timesRedeemed'>): void {
  if (!c.active) throw Errors.badRequest('This coupon is no longer active.');
  if (c.expiresAt && c.expiresAt < new Date()) throw Errors.badRequest('This coupon has expired.');
  if (c.maxRedemptions != null && c.timesRedeemed >= c.maxRedemptions) {
    throw Errors.badRequest('This coupon has reached its redemption limit.');
  }
}

/** Record the redemption (one per user/coupon) and arm the one-time discount. */
async function applyToSubscription(userId: string, coupon: Pick<Coupon, 'id' | 'discountPercent'>, source: 'CODE' | 'ADMIN'): Promise<void> {
  const already = await prisma.couponRedemption.findUnique({
    where: { couponId_userId: { couponId: coupon.id, userId } },
  });
  if (already) throw Errors.conflict('This coupon has already been used on this account.');
  await prisma.$transaction([
    prisma.couponRedemption.create({
      data: { couponId: coupon.id, userId, discountPercent: coupon.discountPercent, source },
    }),
    prisma.coupon.update({ where: { id: coupon.id }, data: { timesRedeemed: { increment: 1 } } }),
    prisma.subscription.update({ where: { userId }, data: { nextInvoiceDiscountPct: coupon.discountPercent } }),
  ]);
}

export const couponService = {
  // ── Admin ─────────────────────────────────────────────────────────────────
  async adminCreate(adminId: string, input: {
    code?: string; discountPercent: number; note?: string;
    expiresAt?: string; maxRedemptions?: number;
  }) {
    const discountPercent = Math.round(input.discountPercent);
    if (discountPercent < 1 || discountPercent > 100) throw Errors.badRequest('Discount must be between 1 and 100%.');
    const code = input.code ? norm(input.code) : null;
    if (code && await prisma.coupon.findUnique({ where: { code } })) {
      throw Errors.conflict(`A coupon with code "${code}" already exists.`);
    }
    const coupon = await prisma.coupon.create({
      data: {
        code, discountPercent, note: input.note ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        maxRedemptions: input.maxRedemptions ?? null,
        createdById: adminId,
      },
    });
    await prisma.auditLog.create({ data: { userId: adminId, action: 'COUPON_CREATE', metadata: { code, discountPercent } } });
    return coupon;
  },

  async adminList() {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { _count: { select: { redemptions: true } } },
    });
    return coupons.map((c) => ({
      id: c.id, code: c.code, discountPercent: c.discountPercent, note: c.note,
      active: c.active, expiresAt: c.expiresAt, maxRedemptions: c.maxRedemptions,
      timesRedeemed: c.timesRedeemed, redemptions: c._count.redemptions, createdAt: c.createdAt,
    }));
  },

  async adminSetActive(adminId: string, couponId: string, active: boolean) {
    const c = await prisma.coupon.update({ where: { id: couponId }, data: { active } });
    await prisma.auditLog.create({ data: { userId: adminId, action: 'COUPON_TOGGLE', metadata: { couponId, active } } });
    return { id: c.id, active: c.active };
  },

  /** Apply a coupon directly to a user → arms their one-time next-invoice discount. */
  async adminApplyToUser(adminId: string, couponId: string, targetUserId: string) {
    const coupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    assertUsable(coupon);
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!target) throw Errors.notFound('User not found');
    await applyToSubscription(targetUserId, coupon, 'ADMIN');
    await prisma.notification.create({
      data: {
        userId: targetUserId, title: '🎟️ Coupon applied',
        body: coupon.discountPercent >= 100
          ? 'Good news — your next invoice is FREE (100% off).'
          : `A ${coupon.discountPercent}% discount was applied to your next invoice.`,
      },
    }).catch(() => {});
    await prisma.auditLog.create({ data: { userId: adminId, action: 'COUPON_APPLY', metadata: { couponId, targetUserId } } });
    return { applied: true, discountPercent: coupon.discountPercent };
  },

  // ── User ───────────────────────────────────────────────────────────────────
  async redeem(userId: string, rawCode: string) {
    const coupon = await prisma.coupon.findUnique({ where: { code: norm(rawCode) } });
    if (!coupon) throw Errors.notFound('Invalid coupon code.');
    assertUsable(coupon);
    await applyToSubscription(userId, coupon, 'CODE');
    return { discountPercent: coupon.discountPercent };
  },

  async myStatus(userId: string) {
    const sub = await prisma.subscription.findUnique({
      where: { userId }, select: { nextInvoiceDiscountPct: true },
    });
    const history = await prisma.couponRedemption.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 20,
      include: { coupon: { select: { code: true, note: true } } },
    });
    return {
      nextInvoiceDiscountPct: sub?.nextInvoiceDiscountPct ?? 0,
      history: history.map((h) => ({
        code: h.coupon.code, note: h.coupon.note, discountPercent: h.discountPercent, source: h.source, at: h.createdAt,
      })),
    };
  },
};
