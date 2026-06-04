import { Router } from 'express';
import { z } from 'zod';
import fetch from 'node-fetch';
import { asyncHandler } from '../../middleware/error.js';
import { ok } from '../../lib/http.js';
import { env } from '../../config/env.js';
import { settingsService } from './settings.service.js';

/** Public, unauthenticated endpoints for the landing page. */
export const publicRouter = Router();

/** GET /api/public/branding — app name, links, copy for the home page. */
publicRouter.get('/branding', asyncHandler(async (_req, res) => ok(res, await settingsService.getBranding())));

/** POST /api/public/feedback — landing-page feedback form. */
const feedbackSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  message: z.string().min(1).max(2000),
});
publicRouter.post('/feedback', asyncHandler(async (req, res) => {
  const input = feedbackSchema.parse(req.body);
  await settingsService.submitFeedback(input, req.ip);
  return ok(res, { received: true });
}));

/**
 * GET /api/public/diagnostics — server-side reachability probe. Tells us, from
 * THIS server's egress IP, whether Binance Futures (fapi) is reachable or geo-
 * blocked (HTTP 451) — the key pre-flight before enabling live trading. Read-only,
 * no secrets. (Safe to remove or gate behind admin auth once verified.)
 */
publicRouter.get('/diagnostics', asyncHandler(async (_req, res) => {
  const probe = async (url: string) => {
    const t0 = Date.now();
    try { const r = await fetch(url, { method: 'GET' }); return { status: r.status, ok: r.ok, ms: Date.now() - t0 }; }
    catch (e) { return { status: 0, ok: false, ms: Date.now() - t0, error: (e as Error).message }; }
  };
  const [fapi, spot, ipRes] = await Promise.all([
    probe(`${env.BINANCE_FAPI_BASE}/fapi/v1/ping`),
    probe(`${env.BINANCE_SPOT_BASE}/api/v3/ping`),
    fetch('https://api.ipify.org?format=json').then((r) => r.json() as Promise<{ ip?: string }>).catch(() => ({ ip: 'unknown' })),
  ]);
  return ok(res, {
    egressIp: ipRes.ip ?? 'unknown',
    binanceFutures: {
      ...fapi,
      verdict: fapi.status === 451 ? 'GEO-BLOCKED — live orders WILL fail; pin Railway region (asia-southeast1-eqsg3a)'
        : fapi.ok ? 'reachable — live trading can place orders' : 'unreachable',
    },
    binanceSpot: spot,
    fapiBase: env.BINANCE_FAPI_BASE,
    serverTime: new Date().toISOString(),
  });
}));
