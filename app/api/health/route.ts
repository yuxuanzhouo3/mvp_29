import { NextResponse } from "next/server"

// 简单的健康检查，不查询数据库
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
}
