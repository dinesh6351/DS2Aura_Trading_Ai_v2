import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

/**
 * Seed an initial ADMIN account. Run: `npm run db:seed`.
 * Override creds with ADMIN_EMAIL / ADMIN_PASSWORD env vars.
 */
const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@platform.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe!2026';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) { console.log(`Admin ${email} already exists.`); return; }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password),
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { fullName: 'Platform Admin' } },
      subscription: { create: {
        plan: 'PRO', status: 'ACTIVE', billingInterval: 'YEAR',
        currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
        paidUntil: new Date(Date.now() + 3650 * 86_400_000),
      } },
      wallet: { create: {} },
      botConfig: { create: { status: 'STOPPED' } },
      watchlists: { create: { symbols: ['BTCUSDT', 'ETHUSDT'] } },
      tradingAccounts: { create: {} },
    },
  });
  console.log(`✅ Admin created: ${user.email} / ${password}  (CHANGE THIS PASSWORD)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
