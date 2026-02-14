import { type NextRequest, NextResponse } from "next/server"
import { getTrtcEnabled } from "@/app/admin/actions"

export async function GET(_request: NextRequest) {
  try {
    const result = await getTrtcEnabled()
    if (result.success) {
      return NextResponse.json({ enabled: result.enabled })
    }
    return NextResponse.json({ enabled: false }, { status: 500 })
  } catch (error) {
    console.error("Get TRTC setting error:", error)
    return NextResponse.json({ enabled: false }, { status: 500 })
  }
}
