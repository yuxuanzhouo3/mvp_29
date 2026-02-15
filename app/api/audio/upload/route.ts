import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { getCloudBaseAdminApp } from "@/lib/cloudbase-admin"

export const runtime = "nodejs"

const MAX_AUDIO_UPLOAD_SIZE = 5 * 1024 * 1024

function resolveAudioExtension(file: File): string {
  const fileName = typeof file.name === "string" ? file.name : ""
  const dotIndex = fileName.lastIndexOf(".")
  if (dotIndex > -1 && dotIndex < fileName.length - 1) {
    return fileName.slice(dotIndex + 1).toLowerCase()
  }

  const type = String(file.type || "").toLowerCase()
  if (type.includes("wav")) return "wav"
  if (type.includes("mp3") || type.includes("mpeg")) return "mp3"
  if (type.includes("ogg")) return "ogg"
  if (type.includes("webm")) return "webm"
  if (type.includes("aac")) return "aac"
  if (type.includes("m4a") || type.includes("mp4")) return "m4a"
  return "webm"
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || ""
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "请使用 multipart/form-data" }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get("audio")

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "缺少音频文件" }, { status: 400 })
    }

    if (file.size <= 0) {
      return NextResponse.json({ success: false, error: "音频文件为空" }, { status: 400 })
    }

    if (file.size > MAX_AUDIO_UPLOAD_SIZE) {
      return NextResponse.json({ success: false, error: "音频文件过大，最大 5MB" }, { status: 400 })
    }

    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, "0")
    const day = String(now.getUTCDate()).padStart(2, "0")
    const ext = resolveAudioExtension(file)
    const cloudPath = `voicelink/audio/${year}/${month}/${day}/${randomUUID()}.${ext}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const app = getCloudBaseAdminApp()
    const uploadRes = await app.uploadFile({ cloudPath, fileContent: buffer })
    const fileId = String((uploadRes as { fileID?: string }).fileID || "").trim()
    if (!fileId) {
      return NextResponse.json({ success: false, error: "上传失败，未获取到文件 ID" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      fileId,
      audioUrl: `/api/audio/file?fileId=${encodeURIComponent(fileId)}`,
    })
  } catch (error) {
    console.error("[Audio Upload] Error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
