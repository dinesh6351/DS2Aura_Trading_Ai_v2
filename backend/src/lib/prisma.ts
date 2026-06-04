import { PrismaClient } from '@prisma/client';
import { env, isProd } from '../config/env.js';

/**
 * Singleton Prisma client. In dev, reuse across hot-reloads to avoid exhausting
 * the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;

void env; // ensure env validation runs before any DB usage
