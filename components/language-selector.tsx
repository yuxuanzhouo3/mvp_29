"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SUPPORTED_LANGUAGES, type Language } from "@/components/voice-chat-interface"
import { useI18n } from "@/components/i18n-provider"

type LanguageSelectorProps = {
  language: Language
  onLanguageChange: (language: Language) => void
  variant?: "panel" | "compact"
}

export function LanguageSelector({
  language,
  onLanguageChange,
  variant = "panel",
}: LanguageSelectorProps) {
  const { t } = useI18n()
  const isCompact = variant === "compact"

  if (isCompact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="sr-only">{t("language.target")}</div>
          <Select
            value={language.code}
            onValueChange={(code) => {
              const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code)
              if (lang) onLanguageChange(lang)
            }}
          >
            <SelectTrigger className="w-full h-9">
              <SelectValue>
                <span className="flex items-center gap-2 truncate">
                  <span>{language.flag}</span>
                  <span className="truncate">{language.name}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="flex items-center gap-2">
                    <span>{lang.flag}</span>
                    <span>{lang.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 bg-card rounded-xl p-4 border border-border">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-sm font-medium text-muted-foreground mb-2 block">{t("language.target")}</label>
          <Select
            value={language.code}
            onValueChange={(code) => {
              const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code)
              if (lang) onLanguageChange(lang)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <span>{language.flag}</span>
                  <span>{language.name}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="flex items-center gap-2">
                    <span>{lang.flag}</span>
                    <span>{lang.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
