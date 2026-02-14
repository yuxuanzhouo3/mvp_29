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
  const publicTarget = String(env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  const isTencent = publicTarget === "tencent" || privateTarget === "tencent"
  if (isTencent) return env[tencentKey] ?? env[key]
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
  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  const isTencent = publicTarget === "tencent" || privateTarget === "tencent"
  if (isTencent && process.env.NODE_ENV !== "production") {
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

export function isMariaDbConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as {
    code?: string
    errno?: number
    sqlState?: string
    sqlMessage?: string
    message?: string
    cause?: unknown
  }
  const code = String(err.code ?? "")
  const message = String(err.sqlMessage ?? err.message ?? "")
  if (code === "ER_GET_CONNECTION_TIMEOUT" || code === "ER_CONNECTION_TIMEOUT") return true
  if (message.includes("pool timeout") || message.includes("Connection timeout")) return true
  const cause = err.cause as {
    code?: string
    sqlMessage?: string
    message?: string
  } | null
  if (cause) {
    const causeCode = String(cause.code ?? "")
    const causeMessage = String(cause.sqlMessage ?? cause.message ?? "")
    if (causeCode === "ER_GET_CONNECTION_TIMEOUT" || causeCode === "ER_CONNECTION_TIMEOUT") return true
    if (causeMessage.includes("pool timeout") || causeMessage.includes("Connection timeout")) return true
  }
  return false
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
  // 优化连接池配置：减少连接数，增加空闲超时
  const pool = createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: 2, // 从5降到2，减少资源消耗
    connectTimeout: 30000,
    acquireTimeout: 30000,
    socketTimeout: 60000,
    idleTimeout: 300000, // 5分钟空闲后关闭连接
    leakDetectionTimeout: 60000, // 检测连接泄漏
  })
  // 始终缓存连接池实例
  globalForPrisma.mariaPool = pool
  return pool
}

export async function getPrisma(): Promise<PrismaClientLike> {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const databaseUrl = resolveDatabaseUrl()
  // Ensure DATABASE_URL is set in process.env for Prisma to pick it up
  process.env.DATABASE_URL = databaseUrl

  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  const isTencent = publicTarget === "tencent" || privateTarget === "tencent"

  if (process.env.DATABASE_URL !== databaseUrl) {
    process.env.DATABASE_URL = databaseUrl
  }
  if (!process.env.TENCENT_DATABASE_URL) {
    process.env.TENCENT_DATABASE_URL = databaseUrl
  }
  const { PrismaClient } = await import("@prisma/client")
  if (isTencent) {
    const url = new URL(databaseUrl)
    if (!globalForPrisma.prismaLogOnce && process.env.NODE_ENV !== "production") {
      const port = url.port || "3306"
      const database = url.pathname.replace(/^\//, "")
      console.log("[Prisma] Using MariaDB", { host: url.hostname, port, database, target: "tencent" })
      globalForPrisma.prismaLogOnce = true
    }
    const { PrismaMariaDb } = await import("@prisma/adapter-mariadb")
    // 优化连接池配置：减少连接数，增加超时时间
    const adapter = new PrismaMariaDb(
      {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ""),
        connectionLimit: 2, // 减少连接数，从5降到2
        connectTimeout: 30000, // 增加超时时间
        acquireTimeout: 30000,
        socketTimeout: 60000,
        idleTimeout: 300000, // 5分钟空闲超时
      },
      {
        onConnectionError: (err) => {
          if (process.env.NODE_ENV !== "production") {
            console.error("[Prisma] MariaDB connection error", err)
          }
        },
      }
    )
    const prisma = new PrismaClient({ 
      adapter,
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : undefined,
    })
    // 始终缓存 Prisma 客户端实例，避免重复创建连接
    globalForPrisma.prisma = prisma
    return prisma
  }
  const prisma = new PrismaClient({})

  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
  return prisma
}
