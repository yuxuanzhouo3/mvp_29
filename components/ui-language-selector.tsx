"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/components/i18n-provider"
import { UI_LOCALES, type UiLocale } from "@/lib/i18n"
import { useAuth } from "@/components/auth-provider"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

export function UiLanguageSelector() {
  const { locale, setLocale } = useI18n()
  const { user } = useAuth()
  const isTencent = process.env.NEXT_PUBLIC_DEPLOY_TARGET === "tencent"
  const currentLocale = UI_LOCALES.find((l) => l.value === locale) ?? UI_LOCALES[0]

  const persistLocale = async (next: UiLocale) => {
    const prev = locale
    setLocale(next)
    if (!user) return
    try {
      if (isTencent) {
        const res = await fetch("/api/user/locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id, email: user.email, uiLocale: next }),
        })
        if (!res.ok) throw new Error("Save locale failed")
        return
      }
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.auth.updateUser({ data: { ui_locale: next } })
      if (error) throw error
    } catch (error) {
      console.error("Failed to persist locale:", error)
      setLocale(prev)
    }
  }

  return (
    <Select value={locale} onValueChange={(value) => void persistLocale(value as UiLocale)}>
      <SelectTrigger className="w-[110px]">
        <SelectValue>
          <span className="flex items-center gap-2">
            <span>{currentLocale.flag}</span>
            <span className="hidden sm:inline">{currentLocale.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {UI_LOCALES.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-2">
              <span>{opt.flag}</span>
              <span>{opt.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
