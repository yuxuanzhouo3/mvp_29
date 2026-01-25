import fs from "node:fs"
import path from "node:path"

type PrismaClientLike = import("@prisma/client").PrismaClient

type MariaDbPool = import("mariadb").Pool

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientLike
  prismaLogOnce?: boolean
  mariaPool?: MariaDbPool
}

function resolveEnvValue(key: string, tencentKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const target = String(env.DEPLOY_TARGET ?? env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent") return env[tencentKey] ?? env[key]
  return env[key] ?? env[tencentKey]
}

function isPrivateHost(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const a = Number(match[1])
  const b = Number(match[2])
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function readEnvFileValue(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined
  const text = fs.readFileSync(filePath, "utf8")
  const regex = new RegExp(`^${key}=(.*)$`, "m")
  const match = text.match(regex)
  if (!match) return undefined
  let value = match[1].trim()
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value
}

function resolveDatabaseUrl(): string {
  let databaseUrl = resolveEnvValue("DATABASE_URL", "TENCENT_DATABASE_URL")
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent" && process.env.NODE_ENV !== "production") {
    const currentUrl = new URL(databaseUrl)
    if (isPrivateHost(currentUrl.hostname)) {
      const envPath = path.join(process.cwd(), ".env.local")
      const candidate =
        readEnvFileValue(envPath, "TENCENT_DATABASE_URL") ?? readEnvFileValue(envPath, "DATABASE_URL")
      if (candidate) {
        const candidateUrl = new URL(candidate)
        if (!isPrivateHost(candidateUrl.hostname)) {
          databaseUrl = candidate
        }
      }
    }
  }
  return databaseUrl
}

export async function getMariaPool(): Promise<MariaDbPool> {
  if (globalForPrisma.mariaPool) return globalForPrisma.mariaPool

  const databaseUrl = resolveDatabaseUrl()
  const url = new URL(databaseUrl)
  if (process.env.NODE_ENV !== "production" && !globalForPrisma.prismaLogOnce) {
    const port = url.port || "3306"
    const database = url.pathname.replace(/^\//, "")
    console.log("[MariaDB] Using", { host: url.hostname, port, database })
    globalForPrisma.prismaLogOnce = true
  }
  const { createPool } = await import("mariadb")
  const pool = createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: 5,
    connectTimeout: 10000,
    acquireTimeout: 10000,
    socketTimeout: 10000,
  })
  if (process.env.NODE_ENV !== "production") globalForPrisma.mariaPool = pool
  return pool
}

export async function getPrisma(): Promise<PrismaClientLike> {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const databaseUrl = resolveDatabaseUrl()
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()

  if (process.env.DATABASE_URL !== databaseUrl) {
    process.env.DATABASE_URL = databaseUrl
  }
  if (!process.env.TENCENT_DATABASE_URL) {
    process.env.TENCENT_DATABASE_URL = databaseUrl
  }
  const { PrismaClient } = await import("@prisma/client")
  if (target === "tencent") {
    const url = new URL(databaseUrl)
    if (!globalForPrisma.prismaLogOnce && process.env.NODE_ENV !== "production") {
      const port = url.port || "3306"
      const database = url.pathname.replace(/^\//, "")
      console.log("[Prisma] Using MariaDB", { host: url.hostname, port, database, target })
      globalForPrisma.prismaLogOnce = true
    }
    const { PrismaMariaDb } = await import("@prisma/adapter-mariadb")
    const adapter = new PrismaMariaDb(
      {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ""),
        connectionLimit: 5,
        connectTimeout: 10000,
        acquireTimeout: 10000,
        socketTimeout: 10000,
      },
      {
        onConnectionError: (err) => {
          if (process.env.NODE_ENV !== "production") {
            console.error("[Prisma] MariaDB connection error", err)
          }
        },
      }
    )
    const prisma = new PrismaClient({ adapter })
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
    return prisma
  }
  const prisma = new PrismaClient({})

  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
  return prisma
}
