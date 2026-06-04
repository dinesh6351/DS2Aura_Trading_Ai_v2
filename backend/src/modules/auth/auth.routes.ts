import { Router } from 'express';
import { z } from 'zod';
import { authService } from './auth.service.js';
import { asyncHandler } from '../../middleware/error.js';
import { authenticate, type AuthedRequest } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { ok } from '../../lib/http.js';
import { isProd } from '../../config/env.js';

export const authRouter = Router();

const meta = (req: { ip?: string; headers: Record<string, unknown> }) => ({
  ip: req.ip,
  userAgent: String(req.headers['user-agent'] ?? ''),
});

const REFRESH_COOKIE = 'rt';
// In prod the frontend and backend are usually on different domains, so the
// refresh cookie must be SameSite=None (+ Secure, HTTPS) or it won't be sent on
// the cross-site refresh and users get bounced to /login. In dev (same-host
// localhost) Lax is correct (None requires Secure, which we don't have on http).
const cookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  path: '/api/auth',
};

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(120),
  mobile: z.string().max(20).optional(),
  country: z.string().max(60).optional(),
  timezone: z.string().max(40).optional(),
});

authRouter.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const { user, tokens, verifyToken } = await authService.register(input, meta(req));
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOpts);
  // verifyToken returned only in non-prod to ease local testing; in prod it's emailed.
  return ok(res, { user, accessToken: tokens.accessToken, expiresIn: tokens.expiresIn,
    ...(isProd ? {} : { verifyToken }) }, 201);
}));

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

authRouter.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password, totp } = loginSchema.parse(req.body);
  const { user, tokens } = await authService.login(email, password, totp, meta(req));
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOpts);
  return ok(res, { user, accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  if (!token) return ok(res, { accessToken: null });
  const tokens = await authService.refresh(token, meta(req));
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOpts);
  return ok(res, { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
}));

authRouter.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await authService.logout((req as AuthedRequest).auth.sessionId);
  res.clearCookie(REFRESH_COOKIE, cookieOpts);
  return ok(res, { loggedOut: true });
}));

/** Email OTP — request + verify (gates the Setup tab). */
authRouter.post('/email-otp/request', authenticate, asyncHandler(async (req, res) =>
  ok(res, await authService.requestEmailOtp((req as AuthedRequest).auth.userId))));

authRouter.post('/email-otp/verify', authenticate, asyncHandler(async (req, res) => {
  const code = z.object({ code: z.string().min(4).max(8) }).parse(req.body).code;
  await authService.verifyEmailOtp((req as AuthedRequest).auth.userId, code);
  return ok(res, { verified: true });
}));

/** Change password (logged-in). Verifies current, revokes other sessions. */
authRouter.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const r = req as AuthedRequest;
  const { currentPassword, newPassword } = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  }).parse(req.body);
  await authService.changePassword(r.auth.userId, r.auth.sessionId, currentPassword, newPassword);
  return ok(res, { changed: true });
}));

// ── 2FA ────────────────────────────────────────────────────────────────────
authRouter.post('/2fa/setup', authenticate, asyncHandler(async (req, res) => {
  const r = req as AuthedRequest;
  const out = await authService.beginEnable2fa(r.auth.userId, r.auth.userId);
  return ok(res, out);
}));

authRouter.post('/2fa/confirm', authenticate, asyncHandler(async (req, res) => {
  const r = req as AuthedRequest;
  const code = z.object({ code: z.string().min(6).max(8) }).parse(req.body).code;
  await authService.confirmEnable2fa(r.auth.userId, code);
  return ok(res, { enabled: true });
}));
