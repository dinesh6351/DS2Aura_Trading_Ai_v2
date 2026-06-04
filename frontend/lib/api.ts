'use client';

import type { ApiResponse } from '@platform/shared';

/**
 * Tiny API client. Access token kept in memory (not localStorage → resilient to
 * XSS token theft); the refresh token lives in an httpOnly cookie set by the
 * backend. On a 401 we transparently call /auth/refresh once and retry.
 */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
  );
}

/**
 * Resolve the HTTP API base.
 * - Deployed (prod): returns '' so every call is RELATIVE (same-origin). A
 *   Next.js rewrite (next.config.mjs) proxies /api/* to the backend, which keeps
 *   the auth refresh cookie FIRST-PARTY. The frontend and backend live on
 *   different *.up.railway.app subdomains, so a cross-site cookie would be
 *   blocked by the browser and log the user out on every reload.
 * - Local dev: the backend runs on :4000 on the same host, so call it directly.
 * Resolved per-call (not at module load) so SSR can't freeze a wrong value.
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (isLocalHost(hostname)) return `${protocol}//${hostname}:4000`;
    return ''; // same-origin; proxied to the backend by next.config.mjs rewrites
  }
  return '';
}

/**
 * WebSocket base for realtime. WS auth uses a token in the query string (not the
 * cookie), so it can safely connect cross-origin straight to the backend — no
 * proxy needed. Set NEXT_PUBLIC_WS_URL to the backend's wss:// origin to enable
 * realtime in production; without it, realtime is simply disabled (the dashboard
 * still loads all data over HTTP).
 */
function getWsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (isLocalHost(hostname)) return `${protocol === 'https:' ? 'wss' : 'ws'}://${hostname}:4000`;
  }
  return '';
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;

async function raw<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return raw<T>(path, init, false);
  }

  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}

/**
 * Single-flight refresh. Concurrent callers (React Strict Mode double-fires the
 * mount effect in dev, and a burst of 401s can each trigger a retry) share ONE
 * in-flight request. Without this, two refreshes with the same rotating cookie
 * make the backend's reuse-detection revoke the session — which looks exactly
 * like "login doesn't work / I get bounced to /login on reload".
 */
export type SessionState = 'valid' | 'none' | 'error';
let refreshInFlight: Promise<SessionState> | null = null;

/**
 * Single-flight refresh, distinguishing three outcomes:
 *  - 'valid' : got a fresh access token (session is good)
 *  - 'none'  : server replied cleanly but there is no session (logged out / expired)
 *  - 'error' : network/parse failure — AMBIGUOUS, must not be treated as logged out
 * Concurrent callers share ONE in-flight request so the rotating refresh cookie is
 * never spent twice (which the backend's reuse-detection would revoke).
 */
function doRefresh(): Promise<SessionState> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      const body = (await res.json()) as ApiResponse<{ accessToken: string | null }>;
      if (body.ok && body.data.accessToken) { setAccessToken(body.data.accessToken); return 'valid'; }
      if (body.ok) return 'none';   // ok:true but accessToken null = no valid session
      return 'error';
    } catch { return 'error'; }
  })();
  // Clear the cache once settled so the NEXT genuine 401 can refresh again.
  void refreshInFlight.finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function tryRefresh(): Promise<boolean> {
  return doRefresh().then((s) => s === 'valid');
}

/**
 * Used by the route guard: returns 'valid' if we already hold a token (SPA nav)
 * or the cookie refreshes; 'none' ONLY when the server confirms no session;
 * 'error' on a transient failure (caller should stay put, not bounce home).
 */
export async function ensureSession(): Promise<SessionState> {
  if (accessToken) return 'valid';
  return doRefresh();
}

export const api = {
  get: <T>(p: string) => raw<T>(p),
  post: <T>(p: string, body?: unknown) => raw<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(p: string, body?: unknown) => raw<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(p: string, body?: unknown) => raw<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(p: string) => raw<T>(p, { method: 'DELETE' }),
  refresh: tryRefresh,
};

/** Open a realtime WS bound to the current access token, subscribe to channels. */
export function openRealtime(channels: string[], onMessage: (m: { channel: string; payload: unknown }) => void) {
  const wsBase = getWsBase();
  if (!accessToken || !wsBase) return () => {};
  const ws = new WebSocket(`${wsBase}/ws?token=${accessToken}`);
  ws.onopen = () => channels.forEach((c) => ws.send(JSON.stringify({ type: 'subscribe', channel: c })));
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  return () => ws.close();
}
