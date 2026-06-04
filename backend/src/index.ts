import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { realtime } from './modules/notifications/realtime.js';
import { startWorkers } from './jobs/worker.js';

/**
 * Single-process boot for dev / small scale (10–100 users): API + WS + the bot
 * worker all run here. For larger scale, run `npm run start` (API+WS only) on
 * web replicas and `npm run worker` separately (see docs/01-system-architecture.md).
 */
const app = createApp();
const server = createServer(app);
realtime.attach(server);

const RUN_WORKERS = process.env.RUN_WORKERS !== 'false';
if (RUN_WORKERS) startWorkers();

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, workers: RUN_WORKERS }, '🚀 API listening');
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    logger.info({ sig }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
