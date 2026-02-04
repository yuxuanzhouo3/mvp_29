"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { getHtmlLang, normalizeLocale, translate, type UiLocale } from "@/lib/i18n"

type I18nContextValue = {
  locale: UiLocale
  setLocale: (locale: UiLocale) => void
  t: (key: string, params?: Record<string, unknown>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = "mornspeaker_locale"

function getFallbackLocale(): UiLocale {
  return (process.env.NEXT_PUBLIC_DEPLOY_TARGET === "tencent") ? "zh" : "en"
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // 初始状态必须与服务端渲染一致，以避免 Hydration Mismatch
  const [locale, setLocaleState] = useState<UiLocale>(getFallbackLocale())
  const [isHydrated, setIsHydrated] = useState(false)

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
  }, [])

  // 在客户端挂载后，从 localStorage 或浏览器设置中恢复语言
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      setLocaleState(normalizeLocale(stored))
    } else if (typeof navigator !== "undefined") {
      setLocaleState(normalizeLocale(navigator.language))
    }
    setIsHydrated(true)
  }, [])

  const t = useCallback(
    (key: string, params: Record<string, unknown> = {}) => {
      return translate(locale, key, params)
    },
    [locale],
  )

  useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.lang = getHtmlLang(locale)
  }, [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider")
  }
  return ctx
}
