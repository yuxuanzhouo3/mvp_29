"use client"

import { ArrowLeftRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SUPPORTED_LANGUAGES, type Language } from "@/components/voice-chat-interface"

type LanguageSelectorProps = {
  userLanguage: Language
  targetLanguage: Language
  onUserLanguageChange: (language: Language) => void
  onTargetLanguageChange: (language: Language) => void
  onSwap: () => void
}

export function LanguageSelector({
  userLanguage,
  targetLanguage,
  onUserLanguageChange,
  onTargetLanguageChange,
  onSwap,
}: LanguageSelectorProps) {
  return (
    <div className="flex flex-col gap-3 bg-card rounded-xl p-4 border border-border">
      <p className="text-sm text-muted-foreground text-center">
        Speak in <span className="font-semibold text-foreground">{userLanguage.name}</span> and hear it translated to{" "}
        <span className="font-semibold text-foreground">{targetLanguage.name}</span>
      </p>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-sm font-medium text-muted-foreground mb-2 block">Source Language (Speak)</label>
          <Select
            value={userLanguage.code}
            onValueChange={(code) => {
              const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code)
              if (lang) onUserLanguageChange(lang)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <span>{userLanguage.flag}</span>
                  <span>{userLanguage.name}</span>
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

        <Button variant="ghost" size="icon" onClick={onSwap} className="mt-6 shrink-0">
          <ArrowLeftRight className="w-5 h-5" />
        </Button>

        <div className="flex-1">
          <label className="text-sm font-medium text-muted-foreground mb-2 block">Target Language (Hear)</label>
          <Select
            value={targetLanguage.code}
            onValueChange={(code) => {
              const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code)
              if (lang) onTargetLanguageChange(lang)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <span>{targetLanguage.flag}</span>
                  <span>{targetLanguage.name}</span>
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
