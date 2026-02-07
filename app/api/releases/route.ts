import { NextRequest, NextResponse } from "next/server"
import { getPrisma } from "@/lib/prisma"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const isTencentTarget = () => {
  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  return publicTarget === "tencent" || privateTarget === "tencent"
}

const getSupabase = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error("缺少 Supabase 环境变量")
  return createClient(supabaseUrl, supabaseKey)
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const platform = String(searchParams.get("platform") || "").trim().toLowerCase()
    if (!platform) {
      return NextResponse.json({ available: false, error: "缺少 platform" }, { status: 400 })
    }
    const variant = isTencentTarget() ? "domestic" : "international"
    const settingKey = `${platform}_release_${variant}`
    const downloadUrl = `/api/downloads?platform=${platform}`

    if (isTencentTarget()) {
      const prisma = await getPrisma()
      const row = await prisma.appSetting.findUnique({ where: { key: settingKey } })
      const value = row?.value
      const release =
        typeof value === "object" && value
          ? {
              version: "version" in value ? String(value.version || "") : "",
              filename: "filename" in value ? String(value.filename || "") : "",
              size: "size" in value ? Number(value.size || 0) : 0,
              updatedAt: "updatedAt" in value ? String(value.updatedAt || "") : "",
              fileId: "fileId" in value ? String(value.fileId || "") : "",
              link: "link" in value ? String(value.link || "") : "",
            }
          : null
      if (!release?.fileId && !release?.link) {
        return NextResponse.json({ available: false })
      }
      return NextResponse.json({
        available: true,
        platform,
        variant,
        version: release.version,
        filename: release.filename,
        size: release.size,
        updatedAt: release.updatedAt,
        downloadUrl: release.link || downloadUrl,
      })
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", settingKey)
      .limit(1)
    if (error) {
      return NextResponse.json({ available: false, error: error.message }, { status: 500 })
    }
    const value = (data?.[0] as { value?: unknown } | undefined)?.value
    const release =
      typeof value === "object" && value
        ? {
            version: "version" in value ? String(value.version || "") : "",
            filename: "filename" in value ? String(value.filename || "") : "",
            size: "size" in value ? Number(value.size || 0) : 0,
            updatedAt: "updatedAt" in value ? String(value.updatedAt || "") : "",
            path: "path" in value ? String(value.path || "") : "",
            link: "link" in value ? String(value.link || "") : "",
          }
        : null
    if (!release?.path && !release?.link) {
      return NextResponse.json({ available: false })
    }
    return NextResponse.json({
      available: true,
      platform,
      variant,
      version: release.version,
      filename: release.filename,
      size: release.size,
      updatedAt: release.updatedAt,
      downloadUrl: release.link || downloadUrl,
    })
  } catch (error) {
    console.error("Release info error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ available: false, error: message }, { status: 500 })
  }
}
