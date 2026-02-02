import { type NextRequest, NextResponse } from "next/server"
import { getMariaPool, isMariaDbConnectionError } from "@/lib/prisma"
import { normalizeLocale, UI_LOCALES, type UiLocale } from "@/lib/i18n"

export const runtime = "nodejs"

const isTencentTarget = () => {
  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  return publicTarget === "tencent" || privateTarget === "tencent"
}

const resolveLocale = (value: unknown): UiLocale | null => {
  if (typeof value !== "string" || !value.trim()) return null
  const normalized = normalizeLocale(value) as UiLocale
  const exists = UI_LOCALES.some((opt) => opt.value === normalized)
  return exists ? normalized : null
}

const ensureUserLocaleColumn = async (allowAlter: boolean): Promise<boolean> => {
  try {
    const pool = await getMariaPool()
    const columnsRows = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'User'"
    )
    const columns = (Array.isArray(columnsRows) ? columnsRows : []).map((c: any) => String(c.column_name || c.COLUMN_NAME || "").toLowerCase())

    const hasLocale = columns.includes("uilocale")
    const hasOpenid = columns.includes("_openid")

    if (hasLocale && hasOpenid) return true
    if (!allowAlter) return hasLocale && hasOpenid

    if (!hasLocale) {
      await pool.query("ALTER TABLE `User` ADD COLUMN uiLocale VARCHAR(10) NULL")
    }
    if (!hasOpenid) {
      await pool.query("ALTER TABLE `User` ADD COLUMN `_openid` VARCHAR(64) DEFAULT '' NOT NULL")
    }
    return true
  } catch (e) {
    console.error("[Locale API] ensureUserLocaleColumn error:", e)
    return false
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isTencentTarget()) {
      return NextResponse.json({ success: false, error: "Not supported" }, { status: 400 })
    }
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId")?.trim()
    const email = searchParams.get("email")?.trim()
    if (!userId && !email) {
      return NextResponse.json({ success: false, error: "Missing userId or email" }, { status: 400 })
    }
    const hasColumn = await ensureUserLocaleColumn(true)
    if (!hasColumn) {
      console.warn("[Locale API] uiLocale column does not exist and could not be created")
      return NextResponse.json({ success: true, uiLocale: null })
    }
    const pool = await getMariaPool()
    const rows = await pool.query(
      email
        ? "SELECT uiLocale FROM `User` WHERE email = ? LIMIT 1"
        : "SELECT uiLocale FROM `User` WHERE id = ? LIMIT 1",
      [email || userId]
    )
    const user = Array.isArray(rows) && rows.length > 0 ? rows[0] : null
    const uiLocale = user?.uiLocale ?? null
    return NextResponse.json({ success: true, uiLocale })
  } catch (error) {
    if (isTencentTarget() && process.env.NODE_ENV !== "production" && isMariaDbConnectionError(error)) {
      return NextResponse.json({ success: true, uiLocale: null })
    }
    console.error("Get locale error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isTencentTarget()) {
      return NextResponse.json({ success: false, error: "Not supported" }, { status: 400 })
    }
    const body = (await request.json()) as { userId?: string; email?: string; uiLocale?: string }
    const userId = body.userId?.trim()
    const email = body.email?.trim()
    const uiLocale = resolveLocale(body.uiLocale)
    if (!userId && !email) {
      return NextResponse.json({ success: false, error: "Missing userId or email" }, { status: 400 })
    }
    if (!uiLocale) {
      return NextResponse.json({ success: false, error: "Invalid uiLocale" }, { status: 400 })
    }
    const hasColumn = await ensureUserLocaleColumn(true)
    if (!hasColumn) {
      console.error("[Locale API] uiLocale column does not exist and could not be created")
      return NextResponse.json({ success: false, uiLocale })
    }
    const pool = await getMariaPool()
    if (email) {
      await pool.query("UPDATE `User` SET uiLocale = ?, updatedAt = NOW() WHERE email = ? LIMIT 1", [
        uiLocale,
        email,
      ])
    } else {
      await pool.query("UPDATE `User` SET uiLocale = ?, updatedAt = NOW() WHERE id = ? LIMIT 1", [
        uiLocale,
        userId,
      ])
    }
    return NextResponse.json({ success: true, uiLocale })
  } catch (error) {
    if (isTencentTarget() && process.env.NODE_ENV !== "production" && isMariaDbConnectionError(error)) {
      return NextResponse.json({ success: false, uiLocale: null, error: "Database unavailable" })
    }
    console.error("Save locale error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
