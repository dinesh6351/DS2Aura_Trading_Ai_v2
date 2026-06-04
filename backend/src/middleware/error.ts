import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, fail, Errors } from '../lib/http.js';
import { logger } from '../lib/logger.js';

/** Wrap async route handlers so thrown errors hit the error middleware. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req as T, res, next).catch(next);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err }, err.message);
    return fail(res, err);
  }
  if (err instanceof ZodError) {
    return fail(res, Errors.badRequest('Validation failed', err.flatten()));
  }
  logger.error({ err }, 'Unhandled error');
  return fail(res, Errors.internal());
}

export function notFoundMiddleware(_req: Request, res: Response) {
  return fail(res, Errors.notFound('Route not found'));
}
