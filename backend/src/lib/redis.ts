import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Optional Redis. Used for:
 *  - distributed rate-limit store
 *  - per-user bot tick locks (so a user's bot never double-ticks across workers)
 *  - realtime fan-out pub/sub
 *
 * Falls back to a no-op in-memory shim when REDIS_URL is unset (local dev),
 * so the app still boots without Redis.
 */
type Lockable = {
  get(key: string): Promise<string | null>;
  set(key: string, val: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
};

let client: Lockable;

if (env.REDIS_URL) {
  const real = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  real.on('error', (e) => logger.error({ err: e }, 'redis error'));
  client = real as unknown as Lockable;
} else {
  logger.warn('REDIS_URL unset — using in-memory shim (single-process only, not for prod scale)');
  const mem = new Map<string, string>();
  client = {
    async get(k) { return mem.get(k) ?? null; },
    async set(k, v) { mem.set(k, v); return 'OK'; },
    async del(k) { return mem.delete(k) ? 1 : 0; },
  };
}

export const redis = client;

/**
 * Best-effort distributed lock for a user's bot tick. Returns true if acquired.
 * ttlMs prevents a crashed worker from holding the lock forever.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<boolean> {
  // ioredis: SET key val NX PX ttl returns 'OK' if set, null if key already exists.
  const res = await client.set(key, '1', 'NX', 'PX', ttlMs);
  return res === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await client.del(key);
}
