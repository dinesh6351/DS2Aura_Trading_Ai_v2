import type { Response } from 'express';
import type { ApiResponse } from '@platform/shared';

/** Standardized error with an HTTP status + machine code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m),
  forbidden: (m = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', m),
  notFound: (m = 'Not found') => new AppError(404, 'NOT_FOUND', m),
  badRequest: (m = 'Bad request', d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d),
  conflict: (m = 'Conflict') => new AppError(409, 'CONFLICT', m),
  tooMany: (m = 'Too many requests') => new AppError(429, 'RATE_LIMITED', m),
  upstream: (m = 'Exchange error', d?: unknown) => new AppError(502, 'UPSTREAM', m, d),
  internal: (m = 'Internal error') => new AppError(500, 'INTERNAL', m),
};

export function ok<T>(res: Response, data: T, status = 200): Response {
  const body: ApiResponse<T> = { ok: true, data };
  return res.status(status).json(body);
}

export function fail(res: Response, err: AppError): Response {
  const body: ApiResponse<never> = {
    ok: false,
    error: { code: err.code, message: err.message, details: err.details },
  };
  return res.status(err.status).json(body);
}
