import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { authenticate, type AuthedRequest } from '../../middleware/auth.js';
import { ok, Errors } from '../../lib/http.js';

export const usersRouter = Router();
usersRouter.use(authenticate);
const uid = (req: unknown) => (req as AuthedRequest).auth.userId;

/** GET /api/me — full profile bundle for the logged-in user. */
usersRouter.get('/me', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: uid(req) },
    include: { profile: true, subscription: true, botConfig: true },
  });
  if (!user) throw Errors.notFound();
  return ok(res, {
    id: user.id, email: user.email, role: user.role, status: user.status,
    twoFactorEnabled: user.twoFactorEnabled, emailVerified: !!user.emailVerifiedAt,
    profile: user.profile, subscription: user.subscription, botConfig: user.botConfig,
  });
}));

const profileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  mobile: z.string().max(20).optional(),
  country: z.string().max(60).optional(),
  timezone: z.string().max(60).optional(),
});
usersRouter.patch('/me/profile', asyncHandler(async (req, res) => {
  const patch = profileSchema.parse(req.body);
  const profile = await prisma.profile.update({ where: { userId: uid(req) }, data: patch });
  return ok(res, profile);
}));

/** GET /api/me/sessions — device/session management (login history). */
usersRouter.get('/me/sessions', asyncHandler(async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: uid(req) }, orderBy: { lastUsedAt: 'desc' }, take: 50,
  });
  return ok(res, sessions.map((s) => ({
    id: s.id, ip: s.ip, userAgent: s.userAgent, device: s.device,
    lastUsedAt: s.lastUsedAt, createdAt: s.createdAt, revoked: !!s.revokedAt,
    current: s.id === (req as AuthedRequest).auth.sessionId,
  })));
}));

usersRouter.delete('/me/sessions/:id', asyncHandler(async (req, res) => {
  await prisma.session.updateMany({
    where: { id: req.params.id, userId: uid(req) }, data: { revokedAt: new Date() },
  });
  return ok(res, { revoked: true });
}));

/** GET /api/me/notifications + mark read. */
usersRouter.get('/me/notifications', asyncHandler(async (req, res) => {
  const items = await prisma.notification.findMany({
    where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 100,
  });
  return ok(res, items);
}));
usersRouter.post('/me/notifications/read', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: uid(req), read: false }, data: { read: true } });
  return ok(res, { ok: true });
}));

/** GET /api/me/audit — the user's own security log. */
usersRouter.get('/me/audit', asyncHandler(async (req, res) => {
  const items = await prisma.auditLog.findMany({
    where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 100,
  });
  return ok(res, items);
}));
