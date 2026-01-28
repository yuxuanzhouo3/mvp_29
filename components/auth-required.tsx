"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"
import { useI18n } from "@/components/i18n-provider"
import { normalizeLocale, type UiLocale } from "@/lib/i18n"

export function AuthRequired({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { locale, setLocale } = useI18n()
  const isTencent = process.env.NEXT_PUBLIC_DEPLOY_TARGET === "tencent"
  const tencentLocaleLoadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace("/login")
    }
  }, [isLoading, router, user])

  useEffect(() => {
    if (isLoading) return
    if (!user) return
    const raw = (user.user_metadata as Record<string, unknown> | null | undefined)?.ui_locale
    const next = normalizeLocale(raw) as UiLocale
    if (raw && next !== locale) setLocale(next)
  }, [isLoading, locale, setLocale, user])

  useEffect(() => {
    if (!isTencent) return
    if (isLoading) return
    if (!user) return
    if (tencentLocaleLoadedRef.current === user.id) return
    tencentLocaleLoadedRef.current = user.id
    const params = new URLSearchParams()
    if (user.id) params.set("userId", user.id)
    if (user.email) params.set("email", user.email)
    const run = async () => {
      try {
        const res = await fetch(`/api/user/locale?${params.toString()}`)
        if (!res.ok) return
        const data = (await res.json()) as { uiLocale?: string | null }
        const raw = data?.uiLocale
        const next = normalizeLocale(raw) as UiLocale
        if (raw && next !== locale) setLocale(next)
      } catch {
        return
      }
    }
    void run()
  }, [isLoading, isTencent, locale, setLocale, user])

  if (isLoading) return null
  if (!user) return null

  return children
}
