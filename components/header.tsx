"use client"

import { Mic2, Trash2, Users, Menu, Copy, LogOut, MoreVertical, Globe, UserCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SettingsDialog, type AppSettings } from "@/components/settings-dialog"
import { useAuth } from "@/components/auth-provider"
import { useRouter } from "next/navigation"
import { useI18n } from "@/components/i18n-provider"
import { UI_LOCALES, type UiLocale } from "@/lib/i18n"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useState } from "react"
import Link from "next/link"
import Image from "next/image"

type HeaderProps = {
  onClearChat?: () => void
  messageCount?: number
  onSettingsChange?: (settings: AppSettings) => void
  onProfileSaved?: (payload: { displayName: string; avatarUrl: string }) => void
  roomId?: string
  roomUserId?: string
  userCount?: number
  onShowUsers?: () => void
  onCopyRoomId?: () => void
  onLeaveRoom?: () => void
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
  onCopyRoomId,
  onLeaveRoom,
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
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Left: Logo & Title */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity shrink-0">
            <div className="w-9 h-9 relative">
              <Image 
                src="/logo.png" 
                alt="MornSpeaker Logo" 
                fill
                className="rounded-lg object-cover"
                priority
              />
            </div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">{t("app.name")}</h1>
          </Link>

          {/* Left: Room Status (Desktop Only) */}
          {roomId && (
            <div className="hidden lg:flex items-center gap-3">
              <div className="h-5 w-[1px] bg-border" />
              <Badge variant="secondary" className="px-3 py-1 text-sm font-medium gap-2 border-primary/10 bg-primary/5">
                <span className="text-muted-foreground">{t("common.roomId")}:</span>
                <span className="text-foreground">{roomId}</span>
              </Badge>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>{t("header.online", { count: userCount ?? 0 })}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Desktop Actions */}
          <div className="hidden lg:flex items-center gap-2">
            {/* Action Group: Room Controls */}
            {roomId && (
              <div className="flex items-center gap-1 mr-2">
                {onCopyRoomId && (
                  <Button variant="ghost" size="sm" onClick={onCopyRoomId} className="h-8 gap-1.5 text-muted-foreground hover:text-foreground">
                    <Copy className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{t("common.copy")}</span>
                  </Button>
                )}
                <SettingsDialog onSettingsChange={onSettingsChange} roomId={roomId} roomUserId={roomUserId} onProfileSaved={onProfileSaved} />
                {onLeaveRoom && (
                  <Button variant="ghost" size="sm" onClick={onLeaveRoom} className="h-8 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10">
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{t("common.leave")}</span>
                  </Button>
                )}
              </div>
            )}

            {roomId && <div className="h-5 w-[1px] bg-border mx-1" />}

            {/* Action Group: User & System */}
            <Select value={locale} onValueChange={(value) => void persistLocale(value as UiLocale)}>
              <SelectTrigger className="w-[100px] h-8 border-none bg-transparent hover:bg-muted/50 focus:ring-0 shadow-none">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm">{currentLocale.label}</span>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-2 pl-2 pr-3 rounded-full hover:bg-muted/50">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                      {profile?.display_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium max-w-[100px] truncate">
                      {profile?.display_name || user.email?.split("@")[0]}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={async () => {
                    await signOut()
                    router.replace("/login")
                  }} className="text-destructive focus:text-destructive">
                    <LogOut className="w-4 h-4 mr-2" />
                    {t("common.logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
