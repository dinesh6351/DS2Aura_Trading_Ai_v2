import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@platform/shared';
import { verifyAccessToken } from '../lib/jwt.js';
import { Errors } from '../lib/http.js';

/** Authenticated request — `req.auth` is populated by `authenticate`. */
export interface AuthedRequest extends Request {
  auth: { userId: string; role: Role; sessionId: string };
}

/**
 * Verify the Bearer access token. The token's `sub` is the ONLY source of the
 * acting user id — clients can never pass a userId in the body/params to act on
 * another tenant. This is the backbone of multi-tenant isolation.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return next(Errors.unauthorized());
  try {
    const claims = verifyAccessToken(token);
    (req as AuthedRequest).auth = { userId: claims.sub, role: claims.role, sessionId: claims.sid };
    next();
  } catch {
    next(Errors.unauthorized('Invalid or expired token'));
  }
}
