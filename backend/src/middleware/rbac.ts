import type { NextFunction, Request, Response } from 'express';
import { Role } from '@platform/shared';
import type { AuthedRequest } from './auth.js';
import { Errors } from '../lib/http.js';

/**
 * Role gate. Usage: `router.get('/admin', authenticate, requireRole(Role.ADMIN), ...)`.
 * ADMIN implicitly passes every gate.
 *
 * Typed with the base Express `Request` (not `AuthedRequest`) so it composes
 * with Express's router overloads; we narrow to the authed shape internally.
 * `authenticate` must run before this, so `req.auth` is present at runtime.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = (req as AuthedRequest).auth?.role;
    if (!role) return next(Errors.unauthorized());
    if (role === Role.ADMIN || allowed.includes(role)) return next();
    next(Errors.forbidden(`Requires one of: ${allowed.join(', ')}`));
  };
}

/** Staff = anyone who can see the back office. */
export const requireStaff = requireRole(Role.ADMIN, Role.MANAGER, Role.SUPPORT);
