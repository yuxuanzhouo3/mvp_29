import { NextResponse, type NextRequest } from "next/server"
import { getMariaPool, getPrisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const outTradeNo = url.searchParams.get("outTradeNo") || url.searchParams.get("out_trade_no") || ""
    if (!outTradeNo.trim()) {
      return NextResponse.json({ success: false, error: "Missing outTradeNo" }, { status: 400 })
    }

    const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
      .trim()
      .toLowerCase()

    if (target === "tencent") {
      const pool = await getMariaPool()
      const rows = await pool.query(
        "SELECT id, userId, amountCny, subject, status, provider, outTradeNo, tradeNo, createdAt, updatedAt FROM `orders` WHERE outTradeNo = ? LIMIT 1",
        [outTradeNo]
      )
      const order = Array.isArray(rows) && rows.length > 0 ? rows[0] : null
      if (!order) {
        return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 })
      }
      return NextResponse.json({
        success: true,
        order: {
          id: order.id,
          userId: order.userId,
          amountCny: order.amountCny,
          subject: order.subject,
          status: order.status,
          provider: order.provider,
          outTradeNo: order.outTradeNo,
          tradeNo: order.tradeNo,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        },
      })
    }

    const prisma = await getPrisma()
    const order = await prisma.order.findUnique({ where: { outTradeNo } })
    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true, order })
  } catch (error) {
    console.error("Order query error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
