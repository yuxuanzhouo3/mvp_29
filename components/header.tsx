"use client"

import { Mic2, Trash2, Users, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SettingsDialog, type AppSettings } from "@/components/settings-dialog"
import { useAuth } from "@/components/auth-provider"
import { useRouter } from "next/navigation"
import { useI18n } from "@/components/i18n-provider"
import { UI_LOCALES, type UiLocale } from "@/lib/i18n"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useState } from "react"
import Link from "next/link"

type HeaderProps = {
  onClearChat?: () => void
  messageCount?: number
  onSettingsChange?: (settings: AppSettings) => void
  onProfileSaved?: (payload: { displayName: string; avatarUrl: string }) => void
  roomId?: string
  roomUserId?: string
  userCount?: number
  onShowUsers?: () => void
}

export function Header({
  onClearChat,
  messageCount = 0,
  onSettingsChange,
  onProfileSaved,
  roomId,
  roomUserId,
  userCount,
  onShowUsers,
}: HeaderProps) {
  const { profile, user, isLoading, signOut } = useAuth()
  const router = useRouter()
  const { locale, setLocale, t } = useI18n()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
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
    } catch {
      setLocale(prev)
    }
  }

  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Mic2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t("app.name")}</h1>
            <p className="text-sm text-muted-foreground">
              {roomId ? (
                <span className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent text-muted-foreground hover:text-foreground font-normal"
                    onClick={onShowUsers}
                  >
                    <Users className="w-3 h-3 mr-1" />
                    <span className="lg:hidden">{userCount ?? 0}</span>
                    <span className="hidden lg:inline">{t("header.online", { count: userCount ?? 0 })}</span>
                  </Button>
                  {messageCount > 0 && (
                    <>
                      <span className="lg:hidden"> • {messageCount}</span>
                      <span className="hidden lg:inline"> • {t("header.messages", { count: messageCount })}</span>
                    </>
                  )}
                </span>
              ) : messageCount > 0 ? (
                t("header.messages", { count: messageCount })
              ) : (
                t("header.subtitle.default")
              )}
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {/* Desktop Actions */}
          <div className="hidden lg:flex items-center gap-2">
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
            {!isLoading && user && (
              <>
                <div className="hidden xl:block text-xs text-muted-foreground max-w-[220px] truncate">
                  {profile?.display_name || user.email}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await signOut()
                    router.replace("/login")
                  }}
                >
                  {t("common.logout")}
                </Button>
              </>
            )}
            {messageCount > 0 && onClearChat && (
              <Button variant="ghost" size="sm" onClick={onClearChat} className="gap-2">
                <Trash2 className="w-4 h-4" />
                <span className="hidden xl:inline">{t("common.clearChat")}</span>
              </Button>
            )}
            <SettingsDialog onSettingsChange={onSettingsChange} roomId={roomId} roomUserId={roomUserId} onProfileSaved={onProfileSaved} />
          </div>

          {/* Mobile Actions */}
          <div className="lg:hidden flex items-center gap-2">
            <SettingsDialog onSettingsChange={onSettingsChange} roomId={roomId} roomUserId={roomUserId} onProfileSaved={onProfileSaved} />
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>{t("app.name")}</SheetTitle>
                  <SheetDescription className="sr-only">
                    移动端导航菜单，包含语言切换和用户操作
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-4 mt-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Language</label>
                    <Select value={locale} onValueChange={(value) => void persistLocale(value as UiLocale)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          <span className="flex items-center gap-2">
                            <span>{currentLocale.flag}</span>
                            <span>{currentLocale.label}</span>
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
                  </div>

                  {!isLoading && user && (
                    <div className="space-y-2 border-t pt-4">
                      <div className="text-sm font-medium">
                        {profile?.display_name || user.email}
                      </div>
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={async () => {
                          await signOut()
                          router.replace("/login")
                        }}
                      >
                        {t("common.logout")}
                      </Button>
                    </div>
                  )}

                  {messageCount > 0 && onClearChat && (
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                      onClick={() => {
                        onClearChat()
                        setIsMobileMenuOpen(false)
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>{t("common.clearChat")}</span>
                    </Button>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  )
}
