import { prisma } from '../../lib/prisma.js';
import { apiKeyService } from '../apikeys/apikeys.service.js';
import { BinanceClient } from '../binance/binance.client.js';
import { isBanned } from '../binance/binance.client.js';
import { billingService } from '../fees/billing.service.js';
import { Errors } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

/**
 * Admin CRM service. All privileged actions write an AdminLog row (who did what
 * to whom and why) for accountability.
 */
export const adminService = {
  /** Platform-wide dashboard metrics. */
  async overview() {
    const [totalUsers, activeUsers, connectedKeys, openPositions] = await Promise.all([
      prisma.user.count(),
      prisma.botConfig.count({ where: { status: 'RUNNING' } }),
      prisma.apiKey.count({ where: { status: 'VALID' } }),
      prisma.position.count({ where: { status: 'OPEN' } }),
    ]);
    const tradesAgg = await prisma.tradeHistory.aggregate({ _sum: { quantity: true }, _count: true });
    const revenue = await billingService.revenueSnapshot(); // subscription MRR + collected/outstanding
    return {
      totalUsers, activeUsers, inactiveUsers: totalUsers - activeUsers,
      connectedAccounts: connectedKeys, openPositions,
      totalTrades: tradesAgg._count,
      totalVolume: Number(tradesAgg._sum.quantity ?? 0),
      // subscription revenue model
      activeSubscriptions: revenue.activeSubscriptions,
      trialingUsers: revenue.trialingUsers,
      pastDueUsers: revenue.pastDueUsers,
      mrrUsd: revenue.mrrUsd,
      collectedRevenueUsd: revenue.collectedRevenueUsd,
      outstandingRevenueUsd: revenue.outstandingRevenueUsd,
      binanceBanActive: isBanned(),
    };
  },

  async listUsers(query: { search?: string; limit?: number; offset?: number }) {
    const where = query.search
      ? { OR: [{ email: { contains: query.search, mode: 'insensitive' as const } }] }
      : {};
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where, take: query.limit ?? 50, skip: query.offset ?? 0, orderBy: { createdAt: 'desc' },
        include: { profile: true, botConfig: true, subscription: true, wallet: true,
                   _count: { select: { positions: true, trades: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    return { total, users: rows.map((u) => ({
      id: u.id, email: u.email, role: u.role, status: u.status,
      fullName: u.profile?.fullName, country: u.profile?.country,
      botStatus: u.botConfig?.status,
      plan: u.subscription?.plan, subStatus: u.subscription?.status,
      tradesThisPeriod: u.subscription?.tradesThisPeriod ?? 0,
      lifetimeProfit: Number(u.wallet?.lifetimeProfit ?? 0),
      openPositions: u._count.positions, totalTrades: u._count.trades,
      createdAt: u.createdAt,
    })) };
  },

  /** Top / worst traders by net profit. */
  async leaderboard(order: 'top' | 'worst') {
    const wallets = await prisma.wallet.findMany({
      orderBy: { lifetimeProfit: order === 'top' ? 'desc' : 'asc' }, take: 10,
      include: { user: { include: { profile: true } } },
    });
    return wallets.map((w) => ({
      userId: w.userId, email: w.user.email, fullName: w.user.profile?.fullName,
      lifetimeProfit: Number(w.lifetimeProfit),
    }));
  },

  async setUserStatus(adminId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED', reason?: string) {
    const user = await prisma.user.update({ where: { id: userId }, data: { status } });
    if (status !== 'ACTIVE') {
      await prisma.botConfig.updateMany({ where: { userId }, data: { status: 'STOPPED', pausedReason: `Admin: ${status}` } });
    }
    await adminLog(adminId, userId, `USER_${status}`, reason);
    return { id: user.id, status: user.status };
  },

  /** Promote/demote a user. ADMIN role = free, unlimited access (no subscription). */
  async setUserRole(adminId: string, userId: string, role: 'ADMIN' | 'MANAGER' | 'SUPPORT' | 'TRADER', reason?: string) {
    if (adminId === userId && role !== 'ADMIN') {
      throw Errors.badRequest('You cannot remove your own admin role.');
    }
    const user = await prisma.user.update({ where: { id: userId }, data: { role } });
    await adminLog(adminId, userId, 'SET_ROLE', reason, { role });
    return { id: user.id, role: user.role };
  },

  async controlBot(adminId: string, userId: string, action: 'PAUSE' | 'RESUME' | 'STOP', reason?: string) {
    const map = { PAUSE: 'PAUSED', RESUME: 'RUNNING', STOP: 'STOPPED' } as const;
    const cfg = await prisma.botConfig.update({ where: { userId }, data: { status: map[action] } });
    await adminLog(adminId, userId, `BOT_${action}`, reason);
    return { status: cfg.status };
  },

  /** Force-close a user's open position (emergency). Uses the user's own keys. */
  async forceClose(adminId: string, userId: string, positionId: string, reason?: string) {
    const pos = await prisma.position.findFirst({ where: { id: positionId, userId, status: 'OPEN' } });
    if (!pos) throw Errors.notFound('Open position not found');
    const creds = await apiKeyService.getDecryptedCreds(userId);
    const client = new BinanceClient(creds);
    const side = pos.side === 'LONG' ? 'SELL' : 'BUY';
    try {
      await client.marketOrder(pos.symbol, side, Number(pos.quantity), true);
    } catch (e) {
      logger.error({ e, positionId }, 'admin force-close failed');
      throw Errors.upstream('Force-close order failed', String(e));
    }
    await prisma.position.update({ where: { id: positionId }, data: { status: 'CLOSED', closedAt: new Date() } });
    await adminLog(adminId, userId, 'FORCE_CLOSE', reason, { positionId, symbol: pos.symbol });
    return { closed: true };
  },

  /** Comp a user a free month (sets ACTIVE Basic for 30 days; no charge). */
  async grantSubscription(adminId: string, userId: string, reason?: string) {
    const meter = await billingService.subscribe(userId);
    await adminLog(adminId, userId, 'GRANT_SUBSCRIPTION', reason);
    return meter;
  },

  async broadcast(adminId: string, title: string, body: string) {
    const users = await prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    await prisma.notification.createMany({
      data: users.map((u) => ({ userId: u.id, title, body })),
    });
    await adminLog(adminId, null, 'BROADCAST', undefined, { title, recipients: users.length });
    return { sent: users.length };
  },

  /** Permanently delete a user + all their data (cascades). Cannot delete self. */
  async deleteUser(adminId: string, userId: string, reason?: string) {
    if (adminId === userId) throw Errors.badRequest('You cannot delete your own account.');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User not found');
    // Stop any open trading first (best-effort), then cascade-delete.
    await prisma.botConfig.updateMany({ where: { userId }, data: { status: 'STOPPED' } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } });
    await adminLog(adminId, userId, 'DELETE_USER', reason, { email: user.email });
    return { deleted: true };
  },

  /** Aggregated reports for the CRM reports panel. */
  async reports() {
    const now = Date.now();
    const since = (d: number) => new Date(now - d * 86_400_000);
    const [newUsers7d, newUsers30d, trades7d, trades30d] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: since(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: since(30) } } }),
      prisma.tradeHistory.count({ where: { closedAt: { gte: since(7) } } }),
      prisma.tradeHistory.count({ where: { closedAt: { gte: since(30) } } }),
    ]);
    const paid = await prisma.usageInvoice.aggregate({ where: { status: 'PAID' }, _sum: { totalCents: true }, _count: true });
    const open = await prisma.usageInvoice.aggregate({ where: { status: 'OPEN' }, _sum: { totalCents: true }, _count: true });
    const byStatus = await prisma.subscription.groupBy({ by: ['status'], _count: true });
    const feedbackRows = await prisma.auditLog.findMany({
      where: { action: 'FEEDBACK' }, orderBy: { createdAt: 'desc' }, take: 25,
    });
    return {
      newUsers7d, newUsers30d, trades7d, trades30d,
      paidInvoices: paid._count, paidUsd: (paid._sum.totalCents ?? 0) / 100,
      openInvoices: open._count, openUsd: (open._sum.totalCents ?? 0) / 100,
      subscriptionsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      feedback: feedbackRows.map((f) => ({ at: f.createdAt, ...(f.metadata as Record<string, unknown> ?? {}) })),
    };
  },

  auditLogs(query: { userId?: string; limit?: number }) {
    return prisma.auditLog.findMany({
      where: query.userId ? { userId: query.userId } : {},
      orderBy: { createdAt: 'desc' }, take: query.limit ?? 200,
    });
  },

  adminLogs(limit = 200) {
    return prisma.adminLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  },
};

async function adminLog(adminId: string, targetUserId: string | null, action: string, reason?: string, metadata?: unknown) {
  await prisma.adminLog.create({ data: { adminId, targetUserId, action, reason, metadata: metadata as object } });
}
function startOfDay() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; }
function startOfMonth() { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d; }
