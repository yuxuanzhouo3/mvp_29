import { NextResponse } from "next/server"
import { getPrisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import tcb from "@cloudbase/node-sdk"
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

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || ""
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "请使用 multipart/form-data 提交" }, { status: 400 })
    }

    const form = await request.formData()
    const variant = String(form.get("variant") || "").trim()
    const version = String(form.get("version") || "").trim()
    const file = form.get("apk")

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "缺少 APK 文件" }, { status: 400 })
    }
    if (!variant || !["domestic", "international"].includes(variant)) {
      return NextResponse.json({ success: false, error: "variant 仅支持 domestic 或 international" }, { status: 400 })
    }
    if (!version) {
      return NextResponse.json({ success: false, error: "缺少版本号 version" }, { status: 400 })
    }

    const filename = file.name || `mornspeaker-${variant}-${version}.apk`
    const settingKey = variant === "domestic" ? "apk_release_domestic" : "apk_release_international"
    const updatedAt = new Date().toISOString()

    if (isTencentTarget()) {
      const envId = process.env.TENCENT_ENV_ID
      const secretId = process.env.TENCENT_SECRET_ID
      const secretKey = process.env.TENCENT_SECRET_KEY
      const app = tcb.init(
        secretId && secretKey ? { env: envId, secretId, secretKey } : { env: envId }
      )
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const cloudPath = `apks/${variant}/${version}/${filename}`
      const result = await app.uploadFile({ cloudPath, fileContent: buffer })
      const fileID: string = (result as { fileID?: string }).fileID || cloudPath

      const prisma = await getPrisma()
      const payload = {
        version,
        filename,
        size: file.size,
        updatedAt,
        fileId: fileID,
      } satisfies Prisma.InputJsonValue
      await prisma.appSetting.upsert({
        where: { key: settingKey },
        create: { key: settingKey, value: payload },
        update: { value: payload },
      })
      return NextResponse.json({ success: true, key: settingKey, fileID })
    }

    const supabase = getSupabase()
    try {
      await supabase.storage.createBucket("apks", { public: false })
    } catch {
      // ignore if exists
    }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const objectPath = `${variant}/${version}/${filename}`
    const uploadRes = await supabase.storage
      .from("apks")
      .upload(objectPath, buffer, { contentType: "application/vnd.android.package-archive", upsert: true })
    if (uploadRes.error) {
      return NextResponse.json({ success: false, error: uploadRes.error.message }, { status: 500 })
    }

    const payload = {
      version,
      filename,
      size: file.size,
      updatedAt,
      path: objectPath,
    }
    const { error: upsertErr } = await supabase.from("app_settings").upsert(
      {
        key: settingKey,
        value: payload,
        updated_at: updatedAt,
      },
      { onConflict: "key" },
    )
    if (upsertErr) {
      return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, key: settingKey, path: objectPath })
  } catch (error) {
    console.error("Upload APK error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
