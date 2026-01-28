import { NextResponse, type NextRequest } from "next/server"
import crypto from "node:crypto"
import { getAlipayNotifyUrl, getAlipayReturnUrl, getAlipaySdk } from "@/lib/alipay"
import { getMariaPool, getPrisma } from "@/lib/prisma"

export const runtime = "nodejs"

function normalizeAmount(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed <= 0) return null
  return Math.round(parsed * 100) / 100
}

function createOutTradeNo() {
  const suffix = crypto.randomBytes(4).toString("hex")
  return `MS${Date.now()}${suffix}`
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const amount = normalizeAmount(payload?.amountCny)
    const subject = String(payload?.subject ?? "").trim() || "MornSpeaker 会员服务"
    const userId = String(payload?.userId ?? "").trim()

    if (!amount) {
      return NextResponse.json({ success: false, error: "Invalid amount" }, { status: 400 })
    }
    if (!userId) {
      return NextResponse.json({ success: false, error: "Missing userId" }, { status: 400 })
    }

    const outTradeNo = createOutTradeNo()
    const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
      .trim()
      .toLowerCase()

    if (target === "tencent") {
      const pool = await getMariaPool()
      await pool.query(
        "INSERT INTO `orders` (id, userId, amountCny, subject, status, provider, outTradeNo, tradeNo, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
        [crypto.randomUUID(), userId, amount.toFixed(2), subject, "pending", "alipay", outTradeNo, null]
      )
    } else {
      const prisma = (await getPrisma()) as any
      await prisma.order.create({
        data: {
          userId,
          amountCny: amount,
          subject,
          status: "pending",
          provider: "alipay",
          outTradeNo,
        },
      })
    }

    const origin = new URL(request.url).origin
    const notifyUrl = getAlipayNotifyUrl() || `${origin}/api/pay/alipay/notify`
    const returnUrl = getAlipayReturnUrl() || `${origin}/pay/result`

    const sdk = getAlipaySdk() as any
    const userAgent = request.headers.get("user-agent") ?? ""
    const isMobile = /mobile|android|iphone|ipad|ipod/i.test(userAgent)
    const apiMethod = isMobile ? "alipay.trade.wap.pay" : "alipay.trade.page.pay"
    const productCode = isMobile ? "QUICK_WAP_PAY" : "FAST_INSTANT_TRADE_PAY"
    const url = await sdk.pageExecute(
      apiMethod,
      {
        notifyUrl,
        returnUrl,
        bizContent: {
          out_trade_no: outTradeNo,
          total_amount: amount.toFixed(2),
          subject,
          product_code: productCode,
        },
      },
      { method: "GET" }
    )

    return NextResponse.json({ success: true, url, outTradeNo })
  } catch (error) {
    console.error("Alipay create error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
