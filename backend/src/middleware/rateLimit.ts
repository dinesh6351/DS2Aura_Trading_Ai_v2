import rateLimit from 'express-rate-limit';

/**
 * Layered rate limits. In production back these with the Redis store
 * (rate-limit-redis) so limits hold across multiple backend replicas.
 */

// Generic API limiter — applied to all /api routes.
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

// Strict limiter for auth endpoints — blunts credential stuffing / brute force.
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many auth attempts' } },
});
