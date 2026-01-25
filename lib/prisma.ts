type PrismaClientLike = import("@prisma/client").PrismaClient

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientLike }

function resolveEnvValue(key: string, tencentKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const target = String(env.DEPLOY_TARGET ?? env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent") return env[tencentKey] ?? env[key]
  return env[key] ?? env[tencentKey]
}

export async function getPrisma(): Promise<PrismaClientLike> {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const databaseUrl = resolveEnvValue("DATABASE_URL", "TENCENT_DATABASE_URL")
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }

  const { PrismaClient } = await import("@prisma/client")
  if (process.env.DATABASE_URL !== databaseUrl) {
    process.env.DATABASE_URL = databaseUrl
  }
  if (!process.env.TENCENT_DATABASE_URL) {
    process.env.TENCENT_DATABASE_URL = databaseUrl
  }
  const prisma = new PrismaClient()

  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
  return prisma
}
