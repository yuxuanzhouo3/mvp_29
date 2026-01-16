"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"

type Ad = {
  id: string
  slotKey: string
  title: string | null
  imageUrl: string | null
  linkUrl: string | null
}

type AdSlotProps = {
  slotKey: string
  className?: string
  variant?: "inline" | "sidebar"
  limit?: number
  fetchLimit?: number
  rotateMs?: number
}

export function AdSlot({ slotKey, className, variant = "inline", limit = 1, fetchLimit, rotateMs = 7000 }: AdSlotProps) {
  const [ads, setAds] = useState<Ad[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [startIndex, setStartIndex] = useState(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const resolvedVisibleCount = Math.max(1, Math.min(6, Number.isFinite(limit) ? Math.floor(limit) : 1))
    const resolvedFetchLimit = Math.max(
      1,
      Math.min(20, Number.isFinite(fetchLimit) ? Math.floor(fetchLimit as number) : resolvedVisibleCount),
    )

    const fetchMany = async (path: string, signal: AbortSignal): Promise<Ad[]> => {
      const res = await fetch(path, {
        method: "GET",
        signal,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
      })
      const data = (await res.json().catch(() => null)) as { ads?: Ad[]; error?: string } | null
      if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`)
      return data?.ads ?? []
    }

    const run = async () => {
      const controller = new AbortController()
      abortControllerRef.current?.abort()
      abortControllerRef.current = controller
      try {
        const bySlot = await fetchMany(
          `/api/ads?slotKey=${encodeURIComponent(slotKey)}&limit=${encodeURIComponent(String(resolvedFetchLimit))}`,
          controller.signal,
        )
        if (bySlot.length > 0) {
          setAds(bySlot)
          return
        }

        const fallback = await fetchMany(`/api/ads?limit=${encodeURIComponent(String(resolvedFetchLimit))}`, controller.signal)
        setAds(fallback)
      } catch {
        setAds([])
      }
    }

    setIsLoading(true)
    void run().finally(() => setIsLoading(false))

    const handleFocus = () => {
      void run()
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void run()
    }

    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibility)
    const intervalId = window.setInterval(() => void run(), 30000)

    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.clearInterval(intervalId)
      abortControllerRef.current?.abort()
    }
  }, [fetchLimit, limit, slotKey])

  useEffect(() => {
    setStartIndex(0)
  }, [ads])

  useEffect(() => {
    const resolvedVisibleCount = Math.max(1, Math.min(6, Number.isFinite(limit) ? Math.floor(limit) : 1))
    const resolvedRotateMs = Math.max(1500, Number.isFinite(rotateMs) ? Math.floor(rotateMs) : 7000)

    if (ads.length <= resolvedVisibleCount) return

    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      setStartIndex((prev) => (prev + 1) % ads.length)
    }, resolvedRotateMs)

    return () => window.clearInterval(id)
  }, [ads.length, limit, rotateMs])

  const visibleAds = useMemo(() => {
    const resolvedVisibleCount = Math.max(1, Math.min(6, Number.isFinite(limit) ? Math.floor(limit) : 1))
    if (ads.length <= resolvedVisibleCount) return ads
    return Array.from({ length: resolvedVisibleCount }, (_, idx) => ads[(startIndex + idx) % ads.length])
  }, [ads, limit, startIndex])

  const resolvedVisibleCount = Math.max(1, Math.min(6, Number.isFinite(limit) ? Math.floor(limit) : 1))

  const renderPlaceholder = (key: string) => (
    <div className={cn("group relative w-full overflow-hidden rounded-xl border border-dashed border-border bg-card p-3")}>
      <div className={cn("flex gap-3 items-center", variant === "sidebar" ? "min-h-16" : "min-h-14")}>
        <div
          className={cn(
            "shrink-0 rounded-lg border border-dashed border-border bg-muted/40",
            variant === "sidebar" ? "h-14 w-24" : "h-12 w-20",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">广告</span>
            <span className="truncate text-sm font-medium text-muted-foreground">暂无可用广告</span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{key}</div>
        </div>
      </div>
    </div>
  )

  if (isLoading && visibleAds.length === 0) {
    return (
      <div className={cn("flex flex-col gap-3 opacity-80", className)}>
        {Array.from({ length: resolvedVisibleCount }, (_, idx) => (
          <div key={`loading-${idx}`}>{renderPlaceholder("加载中...")}</div>
        ))}
      </div>
    )
  }

  if (visibleAds.length === 0) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div>{renderPlaceholder("请在后台添加广告或检查配置")}</div>
      </div>
    )
  }

  const renderCard = (ad: Ad) => {
    const content = (
      <div className={cn("group relative w-full overflow-hidden rounded-xl border border-border bg-card p-3")}>
        <div className={cn("flex gap-3 items-center", variant === "sidebar" ? "min-h-16" : "min-h-14")}>
          {ad.imageUrl ? (
            <div
              className={cn(
                "shrink-0 overflow-hidden rounded-lg border border-border bg-muted",
                variant === "sidebar" ? "h-14 w-24" : "h-12 w-20",
              )}
            >
              <Image
                src={ad.imageUrl}
                alt={ad.title || "广告"}
                width={variant === "sidebar" ? 96 : 80}
                height={variant === "sidebar" ? 56 : 48}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div
              className={cn(
                "shrink-0 rounded-lg border border-dashed border-border bg-muted/40",
                variant === "sidebar" ? "h-14 w-24" : "h-12 w-20",
              )}
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">广告</span>
              {ad.title ? <span className="truncate text-sm font-medium text-foreground">{ad.title}</span> : null}
            </div>
            {ad.linkUrl ? (
              <div className="mt-1 truncate text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                {ad.linkUrl}
              </div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">暂无跳转链接</div>
            )}
          </div>
        </div>
      </div>
    )

    if (!ad.linkUrl) return content

    return (
      <a href={ad.linkUrl} target="_blank" rel="noreferrer" className="block">
        {content}
      </a>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {visibleAds.map((ad, idx) => (
        <div key={`${idx}-${ad.id}`}>{renderCard(ad)}</div>
      ))}
    </div>
  )
}
