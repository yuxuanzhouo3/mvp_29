"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"

type OrderInfo = {
  status: string
  subject: string
  amountCny: string | number
}

const statusLabels: Record<string, string> = {
  pending: "支付处理中",
  paid: "支付成功",
  failed: "支付失败",
  canceled: "已取消",
}

function PayResultContent() {
  const searchParams = useSearchParams()
  const outTradeNo =
    searchParams.get("out_trade_no") || searchParams.get("outTradeNo") || ""
  const [order, setOrder] = useState<OrderInfo | null>(null)
  const [statusText, setStatusText] = useState("正在查询支付状态...")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!outTradeNo) {
      setError("缺少订单号")
      return
    }

    let active = true
    let attempts = 0
    let timer: ReturnType<typeof setInterval> | null = null

    const fetchOrder = async () => {
      attempts += 1
      try {
        const response = await fetch(`/api/pay/orders?outTradeNo=${encodeURIComponent(outTradeNo)}`)
        const data = await response.json()
        if (!active) return
        if (!response.ok || !data?.order) {
          setError(data?.error || "订单查询失败")
          if (timer) clearInterval(timer)
          return
        }
        const nextOrder = data.order as OrderInfo
        setOrder(nextOrder)
        const label = statusLabels[nextOrder.status] || "支付处理中"
        setStatusText(label)
        if (["paid", "failed", "canceled"].includes(nextOrder.status) && timer) {
          clearInterval(timer)
        }
        if (attempts >= 15 && timer) {
          clearInterval(timer)
        }
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : "订单查询失败")
        if (timer) clearInterval(timer)
      }
    }

    fetchOrder()
    timer = setInterval(fetchOrder, 2000)

    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [outTradeNo])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-lg font-semibold">支付结果</div>
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">{statusText}</div>
            {order ? (
              <div className="space-y-1 text-sm">
                <div>订单：{order.subject}</div>
                <div>金额：¥{order.amountCny}</div>
              </div>
            ) : null}
          </>
        )}
        <Button asChild className="w-full">
          <Link href="/">返回首页</Link>
        </Button>
      </div>
    </div>
  )
}

export default function PayResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 space-y-4">
            <div className="text-lg font-semibold">支付结果</div>
            <div className="text-sm text-muted-foreground">正在加载支付状态...</div>
            <Button asChild className="w-full">
              <Link href="/">返回首页</Link>
            </Button>
          </div>
        </div>
      }
    >
      <PayResultContent />
    </Suspense>
  )
}
