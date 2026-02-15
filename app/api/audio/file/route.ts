import { type NextRequest, NextResponse } from "next/server"
import { getCloudBaseAdminApp } from "@/lib/cloudbase-admin"

export const runtime = "nodejs"

const TEMP_URL_MAX_AGE = 60 * 60

export async function GET(request: NextRequest) {
  try {
    const fileId = request.nextUrl.searchParams.get("fileId")?.trim() || ""
    if (!fileId) {
      return NextResponse.json({ success: false, error: "缺少 fileId" }, { status: 400 })
    }

    const app = getCloudBaseAdminApp()
    const result = await app.getTempFileURL({
      fileList: [{ fileID: fileId, maxAge: TEMP_URL_MAX_AGE }],
    })

    const tempUrl = String(result.fileList?.[0]?.tempFileURL || "").trim()
    if (!tempUrl) {
      return NextResponse.json({ success: false, error: "文件不存在或无法访问" }, { status: 404 })
    }

    return NextResponse.redirect(tempUrl, {
      status: 307,
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (error) {
    console.error("[Audio File] Error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
