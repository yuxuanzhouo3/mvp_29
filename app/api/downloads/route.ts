import { NextRequest, NextResponse } from "next/server"
import tcb from "@cloudbase/node-sdk"
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
      return NextResponse.json({ error: "缺少 platform" }, { status: 400 })
    }
    const expectedVariant = isTencentTarget() ? "domestic" : "international"
    const settingKey = `${platform}_release_${expectedVariant}`

    if (isTencentTarget()) {
      const prisma = await getPrisma()
      const row = await prisma.appSetting.findUnique({ where: { key: settingKey } })
      const value = row?.value
      const link = typeof value === "object" && value && "link" in value ? String((value as any).link || "") : ""
      if (link) return NextResponse.redirect(link)
      const fileId = typeof value === "object" && value && "fileId" in value ? String((value as any).fileId || "") : ""
      if (!fileId) return NextResponse.json({ error: "尚未配置下载链接" }, { status: 404 })
      const envId = process.env.TENCENT_ENV_ID || process.env.NEXT_PUBLIC_TENCENT_ENV_ID
      const secretId = process.env.TENCENT_SECRET_ID
      const secretKey = process.env.TENCENT_SECRET_KEY
      const app = tcb.init(
        secretId && secretKey ? { env: envId, secretId, secretKey } : { env: envId }
      )
      const res = await app.getTempFileURL({ fileList: [fileId] })
      const item = res?.fileList?.[0]
      const url: string | undefined = item?.tempFileURL
      if (!url) {
        return NextResponse.json({ error: "无法生成临时下载链接" }, { status: 500 })
      }
      return NextResponse.redirect(url)
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", settingKey)
      .limit(1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const value = (data?.[0] as { value?: any } | undefined)?.value
    const link = value?.link ? String(value.link) : ""
    if (link) return NextResponse.redirect(link)
    const path = value?.path ? String(value.path) : ""
    if (!path) return NextResponse.json({ error: "尚未配置下载链接" }, { status: 404 })
    const { data: signed, error: signErr } = await supabase.storage
      .from("releases")
      .createSignedUrl(path, 60 * 60)
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: signErr?.message || "无法生成下载链接" }, { status: 500 })
    }
    return NextResponse.redirect(signed.signedUrl)
  } catch (error) {
    console.error("Generic download error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
