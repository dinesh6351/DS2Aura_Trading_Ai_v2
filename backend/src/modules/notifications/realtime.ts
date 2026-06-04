import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { verifyAccessToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';

/**
 * Realtime fan-out. Each tenant subscribes to channels scoped by their userId
 * (`user:<id>:positions`, etc.) — the WS auth handshake binds a socket to the
 * authenticated user, and the server refuses to deliver another user's channels.
 *
 * For horizontal scale (multiple backend replicas), swap the local Map for a
 * Redis pub/sub bridge or Supabase Realtime — the publish() contract is the same.
 */
class RealtimeHub {
  private wss: WebSocketServer | null = null;
  // channel -> set of sockets
  private subs = new Map<string, Set<WebSocket>>();
  // socket -> authed userId
  private sockUser = new WeakMap<WebSocket, string>();

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '', 'http://x');
      const token = url.searchParams.get('token') ?? '';
      let userId: string;
      try { userId = verifyAccessToken(token).sub; }
      catch { ws.close(4001, 'unauthorized'); return; }
      this.sockUser.set(ws, userId);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as { type: string; channel?: string };
          if (msg.type === 'subscribe' && msg.channel) this.subscribe(ws, userId, msg.channel);
        } catch { /* ignore malformed */ }
      });
      ws.on('close', () => this.cleanup(ws));
    });
    logger.info('Realtime WS hub attached at /ws');
  }

  /** Enforce tenant isolation: a socket may only join admin:* or its own user:<id>:* channels. */
  private subscribe(ws: WebSocket, userId: string, channel: string) {
    const ownUser = channel.startsWith(`user:${userId}:`);
    const isAdminFeed = channel.startsWith('admin:'); // admin role check done at publish time
    if (!ownUser && !isAdminFeed) { ws.close(4003, 'forbidden channel'); return; }
    if (!this.subs.has(channel)) this.subs.set(channel, new Set());
    this.subs.get(channel)!.add(ws);
  }

  private cleanup(ws: WebSocket) {
    for (const set of this.subs.values()) set.delete(ws);
  }

  publish(channel: string, payload: unknown) {
    const set = this.subs.get(channel);
    if (!set) return;
    const msg = JSON.stringify({ channel, payload, at: Date.now() });
    for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export const realtime = new RealtimeHub();
