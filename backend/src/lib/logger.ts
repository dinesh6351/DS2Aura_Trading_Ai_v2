import pino from 'pino';
import { env, isProd } from '../config/env.js';

/**
 * Structured logger. Redacts anything that smells like a secret so API keys /
 * tokens never land in logs (a common breach vector).
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.apiKey',
      '*.secret',
      '*.secretKey',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.twoFactorSecret',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

export type Logger = typeof logger;
