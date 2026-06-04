import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env, isProd } from './config/env.js';
import { logger } from './lib/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.js';

import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { apiKeysRouter } from './modules/apikeys/apikeys.routes.js';
import { botRouter } from './modules/bot/bot.routes.js';
import { tradingRouter } from './modules/trading/trading.routes.js';
import { billingRouter } from './modules/fees/billing.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { publicRouter } from './modules/settings/public.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind Railway/Vercel proxy → correct req.ip for rate-limit
  app.use(helmet());

  // CORS: in production, lock to PUBLIC_APP_URL. In dev, also accept any
  // localhost / 127.0.0.1 origin (any port) — the browser treats
  // http://localhost:3000 and http://127.0.0.1:3000 as DIFFERENT origins, and
  // Next may bind either, which otherwise causes "Allow-Origin not equal to
  // the supplied origin" failures. The matched origin is reflected back so
  // credentials (cookies) work.
  const allowed = new Set([env.PUBLIC_APP_URL, 'http://localhost:3000', 'http://127.0.0.1:3000']);
  // Dev: accept localhost, 127.0.0.1, OR any private LAN IP (10.x, 192.168.x,
  // 172.16–31.x) on any port — so the app works whether opened at localhost or
  // via the machine's network IP (e.g. http://192.168.0.201:3000 from a phone
  // on the same Wi-Fi). The matched origin is reflected back so the credentialed
  // refresh cookie flows. Prod stays locked to PUBLIC_APP_URL only.
  const devOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(:\d+)?$/;
  app.use(cors({
    origin: (origin, cb) => {
      // non-browser clients (curl, server-to-server) send no Origin → allow
      if (!origin) return cb(null, true);
      if (allowed.has(origin) || (!isProd && devOrigin.test(origin))) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' })); // 1mb allows base64 brand-logo uploads
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  // Health first (no rate limit, no auth)
  app.use('/', healthRouter);

  // All API routes are rate-limited.
  app.use('/api', apiLimiter);
  app.use('/api/public', publicRouter);  // unauthenticated: branding, feedback
  app.use('/api/auth', authRouter);
  app.use('/api', usersRouter);          // /api/me, /api/me/*
  app.use('/api/apikeys', apiKeysRouter);
  app.use('/api/bot', botRouter);
  app.use('/api/trading', tradingRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}
