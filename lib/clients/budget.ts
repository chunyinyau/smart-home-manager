import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prismaBudget: PrismaClient };

export const budgetPrisma = globalForPrisma.prismaBudget || new PrismaClient({ 
  datasourceUrl: process.env.BUDGET_DATABASE_URL 
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBudget = budgetPrisma;