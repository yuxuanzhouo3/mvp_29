"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Users, ArrowRight, LogOut } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import { SettingsDialog } from "@/components/settings-dialog"
import { useI18n } from "@/components/i18n-provider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UI_LOCALES, type UiLocale } from "@/lib/i18n"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

type RoomJoinProps = {
  onJoin: (
    roomId: string,
    userName: string,
    options?: { joinPassword?: string; createJoinMode?: "public" | "password"; createPassword?: string },
  ) => Promise<{ success: boolean; needsPassword?: boolean }>
}

export function RoomJoin({ onJoin }: RoomJoinProps) {
  const { profile, user, signOut, updateProfile } = useAuth()
  const { toast } = useToast()
  const { locale, setLocale, t } = useI18n()
  const [roomId, setRoomId] = useState("")
  const [userName, setUserName] = useState("")
  const [joinPassword, setJoinPassword] = useState("")
  const [createJoinMode, setCreateJoinMode] = useState<"public" | "password">("public")
  const [createPassword, setCreatePassword] = useState("")
  const hasEditedUserNameRef = useRef(false)
  const [isSavingLocale, setIsSavingLocale] = useState(false)
  const currentLocale = UI_LOCALES.find((l) => l.value === locale) ?? UI_LOCALES[0]

  useEffect(() => {
    if (hasEditedUserNameRef.current) return
    if (userName.trim()) return

    if (typeof window !== "undefined") {
      const legacyKey = "voicelink_display_name"
      const userKey =
        (user?.id && `voicelink_display_name:${user.id}`) ||
        (user?.email && `voicelink_display_name:${user.email}`) ||
        "voicelink_display_name:anon"

      const storedByUser = window.localStorage.getItem(userKey)
      if (typeof storedByUser === "string" && storedByUser.trim()) {
        setUserName(storedByUser.trim())
        return
      }

      const storedLegacy = window.localStorage.getItem(legacyKey)
      if (typeof storedLegacy === "string" && storedLegacy.trim()) {
        const next = storedLegacy.trim()
        window.localStorage.setItem(userKey, next)
        setUserName(next)
        return
      }
    }

    const fallback = profile?.display_name || user?.user_metadata?.full_name || user?.email
    if (typeof fallback === "string" && fallback.trim()) {
      setUserName(fallback.trim())
    }
  }, [profile?.display_name, user?.email, user?.id, user?.user_metadata, userName])

  useEffect(() => {
    // Keep password if user typed it, don't clear it on room ID change immediately or it's annoying?
    // Actually clearing it is safer for "Join" tab if room ID changes.
    // But for "Create" tab, if I type room ID then password, it's fine.
    // Let's keep the original logic but maybe scope it.
    // setJoinPassword("") // User might want to pre-fill it.
  }, [roomId])

  const saveUserName = async () => {
    if (userName.trim()) {
      const nextName = userName.trim()
      if (typeof window !== "undefined") {
        const legacyKey = "voicelink_display_name"
        const userKey =
          (user?.id && `voicelink_display_name:${user.id}`) ||
          (user?.email && `voicelink_display_name:${user.email}`) ||
          "voicelink_display_name:anon"
        window.localStorage.setItem(userKey, nextName)
        window.localStorage.setItem(legacyKey, nextName)
      }
      if (user && nextName !== (profile?.display_name ?? "")) {
        void updateProfile({ display_name: nextName }).catch(() => {
          // toast({
          //   title: t("roomJoin.updateNameFailed"),
          //   description: error instanceof Error ? error.message : t("roomJoin.retryLater"),
          //   variant: "destructive",
          // })
        })
      }
      return nextName
    }
    return ""
  }

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nextName = await saveUserName()
    if (roomId.trim() && nextName) {
      const rid = roomId.trim()
      const res = await onJoin(rid, nextName, {
        joinPassword: joinPassword.trim() || undefined,
      })
      if (!res.success && res.needsPassword) {
        toast({
          title: t("toast.passwordRequired"),
          description: t("roomJoin.passwordPlaceholder"),
        })
      }
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nextName = await saveUserName()
    if (roomId.trim() && nextName) {
      const rid = roomId.trim()
      await onJoin(rid, nextName, {
        createJoinMode,
        createPassword: createJoinMode === "password" ? createPassword.trim() : undefined,
      })
    }
  }

  const handleQuickJoin = () => {
    const randomRoom = `room-${Math.random().toString(36).substring(2, 8)}`
    const nextName = userName.trim() || `${locale === "zh" ? "用户" : "User"}${Math.floor(Math.random() * 1000)}`
    if (!userName.trim()) setUserName(nextName)

    // Trigger save manually since state update might be slow
    if (typeof window !== "undefined") {
      const userKey = (user?.id && `voicelink_display_name:${user.id}`) || "voicelink_display_name:anon"
      window.localStorage.setItem(userKey, nextName)
    }

    void onJoin(randomRoom, nextName, { createJoinMode: "public" })
  }

  const handleLocaleChange = async (value: string) => {
    const nextLocale = value as UiLocale
    const prev = locale
    setLocale(nextLocale)

    if (!user) return

    setIsSavingLocale(true)
    try {
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.auth.updateUser({ data: { ui_locale: nextLocale } })
      if (error) throw error
    } catch (error) {
      setLocale(prev)
      toast({
        title: t("toast.errorTitle"),
        description: error instanceof Error ? error.message : t("toast.joinFailed"),
        variant: "destructive",
      })
    } finally {
      setIsSavingLocale(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <Card className="w-full max-w-lg lg:max-w-xl">
        <CardHeader className="text-center">
          <div className="flex w-full justify-end gap-2 mb-2">
            <Select value={locale} onValueChange={handleLocaleChange} disabled={isSavingLocale}>
              <SelectTrigger className="w-[110px] h-9">
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
            <SettingsDialog />
          </div>
          <div className="w-16 h-16 rounded-2xl bg-primary mx-auto mb-4 flex items-center justify-center">
            <Users className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">{t("roomJoin.title")}</CardTitle>
          <CardDescription>{t("roomJoin.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="userName">{t("roomJoin.nicknameLabel")}</Label>
            <Input
              id="userName"
              placeholder={t("roomJoin.nicknamePlaceholder")}
              value={userName}
              onChange={(e) => {
                hasEditedUserNameRef.current = true
                setUserName(e.target.value)
              }}
              required
            />
          </div>

          <Tabs defaultValue="join" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="join">{t("roomJoin.tabJoin")}</TabsTrigger>
              <TabsTrigger value="create">{t("roomJoin.tabCreate")}</TabsTrigger>
            </TabsList>

            <TabsContent value="join" className="space-y-4">
              <form onSubmit={handleJoinSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="roomId-join">{t("roomJoin.roomIdLabel")}</Label>
                  <Input
                    id="roomId-join"
                    placeholder={t("roomJoin.roomIdPlaceholder")}
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="joinPassword">{t("roomJoin.passwordLabel")}</Label>
                  <Input
                    id="joinPassword"
                    type="password"
                    placeholder={t("roomJoin.passwordPlaceholder")} // "Enter room password (if any)" or similar
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                  />
                </div>

                <Button type="submit" className="w-full gap-2" size="lg">
                  {t("roomJoin.join")}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{t("common.or")}</span>
                </div>
              </div>

              <Button variant="outline" onClick={handleQuickJoin} className="w-full bg-transparent">
                {t("roomJoin.quickJoin")}
              </Button>
            </TabsContent>

            <TabsContent value="create" className="space-y-4">
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="roomId-create">{t("roomJoin.roomIdLabel")}</Label>
                  <Input
                    id="roomId-create"
                    placeholder={t("roomJoin.roomIdPlaceholder")}
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">{t("roomJoin.roomIdHelp")}</p>
                </div>

                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <RadioGroup
                    value={createJoinMode}
                    onValueChange={(v) => {
                      const next = v as "public" | "password"
                      setCreateJoinMode(next)
                      if (next === "public") setCreatePassword("")
                    }}
                    className="grid gap-2"
                  >
                    <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 cursor-pointer">
                      <RadioGroupItem value="public" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{t("roomJoin.joinModePublic")}</div>
                        <div className="text-xs text-muted-foreground">{t("roomJoin.joinModePublicDesc")}</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 cursor-pointer">
                      <RadioGroupItem value="password" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{t("roomJoin.joinModePassword")}</div>
                        <div className="text-xs text-muted-foreground">{t("roomJoin.joinModePasswordDesc")}</div>
                      </div>
                    </label>
                  </RadioGroup>
                  {createJoinMode === "password" ? (
                    <div className="space-y-2">
                      <Label htmlFor="createPassword">{t("roomJoin.createPasswordLabel")}</Label>
                      <Input
                        id="createPassword"
                        type="password"
                        placeholder={t("roomJoin.createPasswordPlaceholder")}
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        required
                      />
                    </div>
                  ) : null}
                </div>

                <Button type="submit" className="w-full gap-2" size="lg">
                  {t("roomJoin.create")}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <Button
            variant="ghost"
            onClick={() => signOut()}
            className="w-full text-muted-foreground hover:text-destructive mt-4"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {t("common.logout")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

