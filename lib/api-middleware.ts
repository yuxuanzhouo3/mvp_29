import { type NextRequest, NextResponse } from "next/server"
import { apiRateLimit } from "@/lib/rate-limit"

// 为其他 API 路由提供限流保护
export async function withRateLimit(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const rateLimitCheck = await apiRateLimit()(req)
  if (rateLimitCheck) {
    return rateLimitCheck
  }
  return handler()
}
