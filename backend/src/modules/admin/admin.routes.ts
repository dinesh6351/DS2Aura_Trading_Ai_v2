import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@platform/shared';
import { asyncHandler } from '../../middleware/error.js';
import { authenticate, type AuthedRequest } from '../../middleware/auth.js';
import { requireRole, requireStaff } from '../../middleware/rbac.js';
import { ok } from '../../lib/http.js';
import { adminService } from './admin.service.js';
import { settingsService } from '../settings/settings.service.js';
import { couponService } from '../coupons/coupons.service.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireStaff); // ADMIN/MANAGER/SUPPORT only (ADMIN passes all)
const adminId = (req: unknown) => (req as AuthedRequest).auth.userId;

// ── CRM dashboard ─────────────────────────────────────────────────────────
adminRouter.get('/overview', asyncHandler(async (_req, res) => ok(res, await adminService.overview())));

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const q = z.object({
    search: z.string().optional(),
    limit: z.coerce.number().max(200).optional(),
    offset: z.coerce.number().optional(),
  }).parse(req.query);
  return ok(res, await adminService.listUsers(q));
}));

adminRouter.get('/leaderboard', asyncHandler(async (req, res) => {
  const order = z.enum(['top', 'worst']).default('top').parse(req.query.order);
  return ok(res, await adminService.leaderboard(order));
}));

adminRouter.get('/audit-logs', asyncHandler(async (req, res) =>
  ok(res, await adminService.auditLogs({ userId: req.query.userId as string | undefined }))));

adminRouter.get('/reports', asyncHandler(async (_req, res) => ok(res, await adminService.reports())));

adminRouter.get('/admin-logs', requireRole(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (_req, res) => ok(res, await adminService.adminLogs())));

// ── Privileged controls (ADMIN/MANAGER) ────────────────────────────────────
const mutate = requireRole(Role.ADMIN, Role.MANAGER);

adminRouter.post('/users/:id/status', mutate, asyncHandler(async (req, res) => {
  const { status, reason } = z.object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']), reason: z.string().optional(),
  }).parse(req.body);
  return ok(res, await adminService.setUserStatus(adminId(req), req.params.id!, status, reason));
}));

adminRouter.post('/users/:id/bot', mutate, asyncHandler(async (req, res) => {
  const { action, reason } = z.object({
    action: z.enum(['PAUSE', 'RESUME', 'STOP']), reason: z.string().optional(),
  }).parse(req.body);
  return ok(res, await adminService.controlBot(adminId(req), req.params.id!, action, reason));
}));

adminRouter.post('/users/:id/force-close', mutate, asyncHandler(async (req, res) => {
  const { positionId, reason } = z.object({ positionId: z.string(), reason: z.string().optional() }).parse(req.body);
  return ok(res, await adminService.forceClose(adminId(req), req.params.id!, positionId, reason));
}));

/** Comp a user a free month of Basic (admin grant — no charge). */
adminRouter.post('/users/:id/grant-subscription', requireRole(Role.ADMIN), asyncHandler(async (req, res) => {
  const reason = z.object({ reason: z.string().optional() }).parse(req.body).reason;
  return ok(res, await adminService.grantSubscription(adminId(req), req.params.id!, reason));
}));

/** Promote/demote a user (admin/no-admin toggle). ADMIN = free unlimited access. */
adminRouter.post('/users/:id/role', requireRole(Role.ADMIN), asyncHandler(async (req, res) => {
  const { role, reason } = z.object({
    role: z.enum(['ADMIN', 'MANAGER', 'SUPPORT', 'TRADER']), reason: z.string().optional(),
  }).parse(req.body);
  return ok(res, await adminService.setUserRole(adminId(req), req.params.id!, role, reason));
}));

/** Permanently delete a user and all their data. */
adminRouter.delete('/users/:id', requireRole(Role.ADMIN), asyncHandler(async (req, res) => {
  const reason = (req.query.reason as string | undefined);
  return ok(res, await adminService.deleteUser(adminId(req), req.params.id!, reason));
}));

// ── Branding / site settings (changeable app name, links, copy) ─────────────
adminRouter.get('/settings/branding', asyncHandler(async (_req, res) => ok(res, await settingsService.getBranding())));

adminRouter.put('/settings/branding', requireRole(Role.ADMIN), asyncHandler(async (req, res) => {
  const patch = z.object({
    appName: z.string().min(1).max(60).optional(),
    tagline: z.string().max(160).optional(),
    heroSubtitle: z.string().max(400).optional(),
    logoUrl: z.string().max(800_000).optional(), // URL or base64 data-URL
    webUrl: z.string().max(200).optional(),
    appUrl: z.string().max(200).optional(),
    supportEmail: z.string().max(120).optional(),
    feedbackEmail: z.string().max(120).optional(),
  }).parse(req.body);
  return ok(res, await settingsService.updateBranding(patch, adminId(req)));
}));

adminRouter.post('/broadcast', mutate, asyncHandler(async (req, res) => {
  const { title, body } = z.object({ title: z.string().min(1), body: z.string().min(1) }).parse(req.body);
  return ok(res, await adminService.broadcast(adminId(req), title, body));
}));

// ── Coupons (create codes / direct-grant discounts) ─────────────────────────
adminRouter.get('/coupons', asyncHandler(async (_req, res) => ok(res, await couponService.adminList())));

adminRouter.post('/coupons', mutate, asyncHandler(async (req, res) => {
  const input = z.object({
    code: z.string().max(40).optional(),
    discountPercent: z.coerce.number().min(1).max(100),
    note: z.string().max(200).optional(),
    expiresAt: z.string().optional(),
    maxRedemptions: z.coerce.number().min(1).max(1_000_000).optional(),
  }).parse(req.body);
  return ok(res, await couponService.adminCreate(adminId(req), input), 201);
}));

adminRouter.post('/coupons/:id/active', mutate, asyncHandler(async (req, res) => {
  const active = z.object({ active: z.boolean() }).parse(req.body).active;
  return ok(res, await couponService.adminSetActive(adminId(req), req.params.id!, active));
}));

/** Apply a coupon directly to a user → arms their one-time next-invoice discount. */
adminRouter.post('/coupons/:id/apply', mutate, asyncHandler(async (req, res) => {
  const userId = z.object({ userId: z.string().min(1) }).parse(req.body).userId;
  return ok(res, await couponService.adminApplyToUser(adminId(req), req.params.id!, userId));
}));
