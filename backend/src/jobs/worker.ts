import { logger } from '../lib/logger.js';
import { botManager, resetDailyCounters } from '../modules/bot/manager.js';
import { billingService } from '../modules/fees/billing.service.js';
import { apiKeyService } from '../modules/apikeys/apikeys.service.js';
import { prisma } from '../lib/prisma.js';

/**
 * Background workers:
 *  - bot manager: ticks every RUNNING tenant's bot (per-user locked, see manager.ts)
 *  - daily reset: zero per-day trade counters at UTC midnight
 *  - billing cycle: close any subscription period that has ended → emit a monthly
 *    UsageInvoice ($10 base + $0.10/overage), reset the usage counter, advance period
 *
 * Can run inside the API process (small scale) or as a dedicated `npm run worker`
 * process (scale). Idempotent locks make multiple worker replicas safe.
 */
export function startWorkers() {
  botManager.start();

  // One-off: fingerprint any API keys connected before one-account-one-user
  // enforcement, so duplicates are detectable. Fire-and-forget, idempotent.
  void apiKeyService.backfillKeyFingerprints().catch((e) => logger.error({ e }, 'api-key fingerprint backfill failed'));

  // Clear stale daily counters right now (per each user's local day), then keep
  // checking every minute — each user resets at THEIR local midnight, not UTC.
  void resetDailyCounters().catch((e) => logger.error({ e }, 'initial daily reset failed'));
  setInterval(async () => {
    await resetDailyCounters();
    await runBillingCycle(); // also catches per-minute any period that just ended
  }, 60_000);

  logger.info('background workers started');
}

/** Close + invoice every subscription whose current period has ended. */
async function runBillingCycle() {
  const due = await prisma.subscription.findMany({
    where: { currentPeriodEnd: { lte: new Date() }, status: { in: ['ACTIVE', 'TRIALING'] } },
    select: { userId: true },
  });
  for (const s of due) {
    try { await billingService.closePeriodAndInvoice(s.userId); }
    catch (e) { logger.error({ e, userId: s.userId }, 'billing cycle failed'); }
  }
  // Expire lapsed paid terms (PRO after its annual term, trials after 30d). BASIC
  // auto-extends its term on monthly rollover above, so it won't be caught here.
  const lapsed = await prisma.subscription.updateMany({
    where: { paidUntil: { lt: new Date() }, status: { in: ['ACTIVE', 'TRIALING'] } },
    data: { status: 'EXPIRED' },
  });
  if (due.length || lapsed.count) logger.info({ rolled: due.length, expired: lapsed.count }, 'billing cycle complete');
}

// Allow running standalone: `tsx src/jobs/worker.ts`
if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  startWorkers();
}
