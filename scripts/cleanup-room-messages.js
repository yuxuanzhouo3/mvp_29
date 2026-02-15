#!/usr/bin/env node

const { PrismaClient } = require("@prisma/client")
const fs = require("node:fs")
const path = require("node:path")

function loadLocalEnvFiles() {
  const candidates = [".env.local", ".env"]
  for (const filename of candidates) {
    const filePath = path.join(process.cwd(), filename)
    if (!fs.existsSync(filePath)) continue
    const content = fs.readFileSync(filePath, "utf8")
    const lines = content.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (!key || process.env[key]) continue
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

function ensureDatabaseUrl() {
  loadLocalEnvFiles()
  if (process.env.DATABASE_URL) return

  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET || "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET || "").trim().toLowerCase()
  const isTencent = publicTarget === "tencent" || privateTarget === "tencent"

  const fallback = isTencent
    ? process.env.TENCENT_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL || process.env.TENCENT_DATABASE_URL

  if (fallback) {
    process.env.DATABASE_URL = fallback
  }
}

function validateMysqlDatabaseUrl() {
  const url = String(process.env.DATABASE_URL || "").trim()
  if (!url) {
    throw new Error("Missing DATABASE_URL/TENCENT_DATABASE_URL")
  }
  if (!url.startsWith("mysql://")) {
    throw new Error("DATABASE_URL must be mysql://... (当前值不是 MySQL 连接串)")
  }
}

function parseArgs(argv) {
  const args = {
    days: 7,
    keepPerRoom: 200,
    dryRun: true,
  }

  for (const item of argv) {
    if (item === "--execute") {
      args.dryRun = false
      continue
    }
    if (item === "--dry-run") {
      args.dryRun = true
      continue
    }
    if (item.startsWith("--days=")) {
      const value = Number(item.split("=")[1])
      if (Number.isFinite(value) && value >= 0) args.days = Math.floor(value)
      continue
    }
    if (item.startsWith("--keep-per-room=")) {
      const value = Number(item.split("=")[1])
      if (Number.isFinite(value) && value >= 0) args.keepPerRoom = Math.floor(value)
    }
  }

  return args
}

function toCount(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  const row = rows[0] || {}
  const raw = row.cnt ?? row.count ?? Object.values(row)[0] ?? 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

async function main() {
  ensureDatabaseUrl()
  validateMysqlDatabaseUrl()
  const { days, keepPerRoom, dryRun } = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()

  try {
    const totalRows = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS cnt FROM room_messages")
    const embeddedAudioRows = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS cnt FROM room_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.audioUrl')) LIKE 'data:%'",
    )
    const oldRows = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS cnt FROM room_messages WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
      days,
    )
    const overflowRows =
      keepPerRoom > 0
        ? await prisma.$queryRawUnsafe(
            "SELECT COUNT(*) AS cnt FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at DESC) AS rn FROM room_messages) t WHERE t.rn > ?",
            keepPerRoom,
          )
        : [{ cnt: 0 }]

    console.log("[Cleanup] room_messages total:", toCount(totalRows))
    console.log("[Cleanup] data:audio rows:", toCount(embeddedAudioRows))
    console.log(`[Cleanup] older than ${days} day(s):`, toCount(oldRows))
    console.log(`[Cleanup] overflow rows (keep ${keepPerRoom}/room):`, toCount(overflowRows))

    if (dryRun) {
      console.log("[Cleanup] Dry run only. Re-run with --execute to apply changes.")
      return
    }

    const strippedAudio = await prisma.$executeRawUnsafe(
      "UPDATE room_messages SET data = JSON_REMOVE(data, '$.audioUrl') WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.audioUrl')) LIKE 'data:%'",
    )
    console.log("[Cleanup] stripped embedded audio rows:", Number(strippedAudio || 0))

    const deletedOld = await prisma.$executeRawUnsafe(
      "DELETE FROM room_messages WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
      days,
    )
    console.log("[Cleanup] deleted old rows:", Number(deletedOld || 0))

    if (keepPerRoom > 0) {
      const deletedOverflow = await prisma.$executeRawUnsafe(
        "DELETE rm FROM room_messages rm JOIN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at DESC) AS rn FROM room_messages) ranked WHERE ranked.rn > ?) stale ON stale.id = rm.id",
        keepPerRoom,
      )
      console.log("[Cleanup] deleted overflow rows:", Number(deletedOverflow || 0))
    }

    const afterRows = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS cnt FROM room_messages")
    console.log("[Cleanup] room_messages total after cleanup:", toCount(afterRows))
    console.log("[Cleanup] Done.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("[Cleanup] Failed:", error)
  process.exitCode = 1
})
