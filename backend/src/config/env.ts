import 'dotenv/config';
import { z } from 'zod';

/**
 * Validate and freeze all environment configuration at boot.
 * Fail fast: a misconfigured secret should crash on start, never at runtime
 * in the middle of a trade.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2_592_000),

  // base64-encoded 32-byte key for AES-256-GCM
  API_KEY_ENC_KEY: z.string().min(1),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  BINANCE_FAPI_BASE: z.string().url().default('https://fapi.binance.com'),
  BINANCE_SPOT_BASE: z.string().url().default('https://api.binance.com'),

  // Subscription billing-cycle cron (monthly invoice generation, UTC).
  BILLING_CRON: z.string().default('0 0 * * *'),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMTP_URL: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/** Decoded 32-byte AES key, validated to be exactly 32 bytes. */
export const API_KEY_ENC_KEY = (() => {
  const buf = Buffer.from(env.API_KEY_ENC_KEY, 'base64');
  if (buf.length !== 32) {
    // eslint-disable-next-line no-console
    console.error('❌ API_KEY_ENC_KEY must decode to exactly 32 bytes (base64 of 32 random bytes).');
    process.exit(1);
  }
  return buf;
})();
