type PrismaClientLike = import("@prisma/client").PrismaClient

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientLike }

export async function getPrisma(): Promise<PrismaClientLike> {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }

  const { PrismaClient } = await import("@prisma/client")
  const adapter = new PrismaMariaDb(databaseUrl)
  const prisma = new PrismaClient({ adapter })

  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
  return prisma
}
