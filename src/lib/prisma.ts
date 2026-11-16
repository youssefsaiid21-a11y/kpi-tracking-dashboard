import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

// Cache singleton in ALL environments to prevent connection pool exhaustion
globalForPrisma.prisma = prisma;

export default prisma;
