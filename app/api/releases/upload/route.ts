import { NextResponse } from "next/server"
import tcb from "@cloudbase/node-sdk"
import { createClient } from "@supabase/supabase-js"
import { getPrisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

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

const SUPABASE_BUCKET = "releases"

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || ""
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "请使用 multipart/form-data 提交" }, { status: 400 })
    }
    const form = await request.formData()
    const platform = String(form.get("platform") || "").trim().toLowerCase()
    const version = String(form.get("version") || "").trim()
    const link = String(form.get("link") || "").trim()
    const file = form.get("file")
    if (!platform) {
      return NextResponse.json({ success: false, error: "缺少 platform" }, { status: 400 })
    }
    if (!version) {
      return NextResponse.json({ success: false, error: "缺少版本号 version" }, { status: 400 })
    }
    const variant = isTencentTarget() ? "domestic" : "international"
    const settingKey = `${platform}_release_${variant}`
    const updatedAt = new Date().toISOString()

    if (link && !file) {
      if (isTencentTarget()) {
        const prisma = await getPrisma()
        const payload = { version, link, updatedAt } satisfies Prisma.InputJsonValue
        await prisma.appSetting.upsert({
          where: { key: settingKey },
          create: { key: settingKey, value: payload },
          update: { value: payload },
        })
        return NextResponse.json({ success: true, key: settingKey, link })
      }
      const supabase = getSupabase()
      const payload = { version, link, updatedAt }
      const { error } = await supabase.from("app_settings").upsert(
        { key: settingKey, value: payload, updated_at: updatedAt },
        { onConflict: "key" },
      )
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, key: settingKey, link })
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "缺少文件或文件无效" }, { status: 400 })
    }
    const filename = file.name || `${platform}-${version}`

    if (isTencentTarget()) {
      const envId = process.env.TENCENT_ENV_ID || process.env.NEXT_PUBLIC_TENCENT_ENV_ID
      const secretId =
        process.env.TENCENT_SECRET_ID ||
        process.env.TENCENTCLOUD_SECRETID ||
        process.env.TENCENT_CLOUD_SECRETID
      const secretKey =
        process.env.TENCENT_SECRET_KEY ||
        process.env.TENCENTCLOUD_SECRETKEY ||
        process.env.TENCENT_CLOUD_SECRETKEY
      const hasCloudRuntime = Boolean(process.env.TENCENTCLOUD_RUNENV || process.env.TENCENT_APP_ID)
      if (!envId) {
        return NextResponse.json({ success: false, error: "缺少 TENCENT_ENV_ID" }, { status: 500 })
      }
      if (!hasCloudRuntime && (!secretId || !secretKey)) {
        return NextResponse.json(
          { success: false, error: "缺少 CloudBase 密钥，请配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY" },
          { status: 500 },
        )
      }
      const app = tcb.init(secretId && secretKey ? { env: envId, secretId, secretKey } : { env: envId })
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const cloudPath = `releases/${platform}/${version}/${filename}`
      const result = await app.uploadFile({ cloudPath, fileContent: buffer })
      const fileId: string = (result as { fileID?: string }).fileID || cloudPath

      const prisma = await getPrisma()
      const payload = {
        version,
        filename,
        size: file.size,
        updatedAt,
        fileId,
      } satisfies Prisma.InputJsonValue
      await prisma.appSetting.upsert({
        where: { key: settingKey },
        create: { key: settingKey, value: payload },
        update: { value: payload },
      })
      return NextResponse.json({ success: true, key: settingKey, fileId })
    }

    const supabase = getSupabase()
    try {
      await supabase.storage.createBucket(SUPABASE_BUCKET, { public: false })
    } catch { }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const objectPath = `${platform}/${version}/${filename}`
    const uploadRes = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(objectPath, buffer, { contentType: file.type || "application/octet-stream", upsert: true })
    if (uploadRes.error) {
      return NextResponse.json({ success: false, error: uploadRes.error.message }, { status: 500 })
    }
    const payload = { version, filename, size: file.size, updatedAt, path: objectPath }
    const { error } = await supabase.from("app_settings").upsert(
      { key: settingKey, value: payload, updated_at: updatedAt },
      { onConflict: "key" },
    )
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, key: settingKey, path: objectPath })
  } catch (error) {
    console.error("Upload release error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
