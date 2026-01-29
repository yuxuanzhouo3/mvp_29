import { type NextRequest, NextResponse } from "next/server"
import { getMariaPool } from "@/lib/prisma"
import { normalizeLocale, UI_LOCALES, type UiLocale } from "@/lib/i18n"

export const runtime = "nodejs"

const isTencentTarget = () => {
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
    .trim()
    .toLowerCase()
  return target === "tencent"
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
    const rows = await pool.query(
      "SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'User' AND column_name = 'uiLocale'"
    )
    const count =
      Array.isArray(rows) && rows.length > 0
        ? Number((rows[0] as { cnt?: number | string }).cnt ?? 0)
        : 0
    if (count > 0) return true
    if (!allowAlter) return false
    await pool.query("ALTER TABLE `User` ADD COLUMN uiLocale VARCHAR(10) NULL")
    return true
  } catch {
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
    const hasColumn = await ensureUserLocaleColumn(false)
    if (!hasColumn) {
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
    const hasColumn = await ensureUserLocaleColumn(process.env.NODE_ENV !== "production")
    if (!hasColumn) {
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
    console.error("Save locale error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
