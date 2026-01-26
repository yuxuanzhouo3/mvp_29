import { type NextRequest } from "next/server"
import crypto from "node:crypto"
import { getAlipaySdk } from "@/lib/alipay"
import { getMariaPool, getPrisma } from "@/lib/prisma"

export const runtime = "nodejs"

function normalizeParamValue(value: FormDataEntryValue) {
  if (typeof value === "string") return value
  return ""
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const params: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      params[key] = normalizeParamValue(value)
    }

    const sdk = getAlipaySdk()
    const isValid = sdk.checkNotifySign(params)
    if (!isValid) {
      return new Response("failure", { status: 400 })
    }

    const outTradeNo = params.out_trade_no?.trim()
    const tradeStatus = params.trade_status?.trim()
    const tradeNo = params.trade_no?.trim()
    const buyerId = params.buyer_id?.trim() || null
    const totalAmount = params.total_amount?.trim()
    const payTime = params.gmt_payment?.trim()

    if (!outTradeNo || !tradeStatus) {
      return new Response("failure", { status: 400 })
    }

    if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(tradeStatus)) {
      return new Response("success")
    }

    const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
      .trim()
      .toLowerCase()

    if (target === "tencent") {
      const pool = await getMariaPool()
      const rows = await pool.query(
        "SELECT id, status FROM `orders` WHERE outTradeNo = ? LIMIT 1",
        [outTradeNo]
      )
      const order = Array.isArray(rows) && rows.length > 0 ? rows[0] : null
      if (!order) {
        return new Response("failure", { status: 404 })
      }

      if (order.status !== "paid") {
        await pool.query(
          "UPDATE `orders` SET status = ?, tradeNo = ?, updatedAt = NOW() WHERE id = ?",
          ["paid", tradeNo || null, order.id]
        )
      }

      if (tradeNo) {
        const existing = await pool.query("SELECT id FROM `payments` WHERE tradeNo = ? LIMIT 1", [tradeNo])
        if (!Array.isArray(existing) || existing.length === 0) {
          await pool.query(
            "INSERT INTO `payments` (id, orderId, provider, tradeNo, buyerId, payAmountCny, payTime, rawNotify, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())",
            [
              crypto.randomUUID(),
              order.id,
              "alipay",
              tradeNo,
              buyerId,
              totalAmount || null,
              payTime ? new Date(payTime) : null,
              JSON.stringify(params),
            ]
          )
        }
      }
    } else {
      const prisma = await getPrisma()
      const order = await prisma.order.findUnique({ where: { outTradeNo } })
      if (!order) {
        return new Response("failure", { status: 404 })
      }

      if (order.status !== "paid") {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: "paid", tradeNo: tradeNo || null },
        })
      }

      if (tradeNo) {
        const existing = await prisma.payment.findFirst({ where: { tradeNo } })
        if (!existing) {
          await prisma.payment.create({
            data: {
              orderId: order.id,
              provider: "alipay",
              tradeNo,
              buyerId: buyerId || undefined,
              payAmountCny: totalAmount ? Number(totalAmount) : 0,
              payTime: payTime ? new Date(payTime) : undefined,
              rawNotify: params as Record<string, string>,
            },
          })
        }
      }
    }

    return new Response("success")
  } catch (error) {
    console.error("Alipay notify error:", error)
    return new Response("failure", { status: 500 })
  }
}
