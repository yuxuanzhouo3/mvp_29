"use client"

import { Settings, Moon, Sun, Volume2, Download, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { useState, useEffect, useMemo } from "react"
import { useI18n } from "@/components/i18n-provider"

type SettingsDialogProps = {
  onSettingsChange?: (settings: AppSettings) => void
  roomId?: string
  roomUserId?: string
  onProfileSaved?: (payload: { displayName: string; avatarUrl: string }) => void
}

export type AppSettings = {
  darkMode: boolean
  autoPlayTranslations: boolean
  speechRate: number
  speechVolume: number
  saveHistory: boolean
  platform: "web" | "wechat" | "android" | "ios" | "desktop"
}

export function SettingsDialog({ onSettingsChange, roomId, roomUserId, onProfileSaved }: SettingsDialogProps) {
  const { toast } = useToast()
  const { user, profile, updateProfile } = useAuth()
  const { t } = useI18n()
  const isTencent = process.env.NEXT_PUBLIC_DEPLOY_TARGET === "tencent"

  const [settings, setSettings] = useState<AppSettings>({
    darkMode: false,
    autoPlayTranslations: false,
    speechRate: 0.9,
    speechVolume: 1.0,
    saveHistory: true,
    platform: "web",
  })

  useEffect(() => {
    const savedSettings = localStorage.getItem("voicelink-settings")
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings)
      setSettings(parsed)
      if (parsed.darkMode) {
        document.documentElement.classList.add("dark")
      }
    }
  }, [])

  const initialDisplayName = useMemo(() => {
    if (typeof window !== "undefined") {
      const userKey =
        (user?.id && `voicelink_display_name:${user.id}`) ||
        (user?.email && `voicelink_display_name:${user.email}`) ||
        null
      if (userKey) {
        const storedByUser = window.localStorage.getItem(userKey)
        if (typeof storedByUser === "string" && storedByUser.trim()) return storedByUser.trim()
      }
      const stored = window.localStorage.getItem("voicelink_display_name")
      if (typeof stored === "string" && stored.trim()) return stored.trim()
    }
    return profile?.display_name || user?.user_metadata?.full_name || user?.email || ""
  }, [profile?.display_name, user?.email, user?.id, user?.user_metadata])

  const [displayName, setDisplayName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [isCreatingPay, setIsCreatingPay] = useState(false)

  useEffect(() => {
    setDisplayName(initialDisplayName)
    setAvatarUrl(profile?.avatar_url ?? "")
  }, [initialDisplayName, profile?.avatar_url])

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    localStorage.setItem("voicelink-settings", JSON.stringify(newSettings))

    if (key === "darkMode") {
      if (value) {
        document.documentElement.classList.add("dark")
      } else {
        document.documentElement.classList.remove("dark")
      }
    }

    onSettingsChange?.(newSettings)
  }

  const saveProfile = async () => {
    if (!user) {
      toast({ title: t("settings.notLoggedInTitle"), description: t("settings.profileNotLoggedInDesc"), variant: "destructive" })
      return
    }

    const nextDisplayName = displayName.trim()
    const nextAvatarUrl = avatarUrl.trim()

    if (!nextDisplayName) {
      toast({ title: t("settings.nicknameRequiredTitle"), description: t("settings.nicknameRequiredDesc"), variant: "destructive" })
      return
    }

    setIsSavingProfile(true)
    try {
      const patch: { display_name?: string; avatar_url?: string | null } = {}
      if (nextDisplayName !== (profile?.display_name ?? "")) patch.display_name = nextDisplayName
      if (nextAvatarUrl !== (profile?.avatar_url ?? "")) patch.avatar_url = nextAvatarUrl ? nextAvatarUrl : null

      if (Object.keys(patch).length > 0 && !isTencent) {
        await updateProfile(patch)
      }
      if (isTencent) {
        const res = await fetch("/api/user/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id, email: user.email, displayName: nextDisplayName }),
        })
        if (!res.ok) throw new Error("Save profile failed")
      }

      if (typeof window !== "undefined") {
        const userKey =
          (user?.id && `voicelink_display_name:${user.id}`) ||
          (user?.email && `voicelink_display_name:${user.email}`) ||
          "voicelink_display_name"
        window.localStorage.setItem(userKey, nextDisplayName)
        window.localStorage.setItem("voicelink_display_name", nextDisplayName)
      }

      if (roomId && roomUserId) {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_user",
            roomId,
            userId: roomUserId,
            userName: nextDisplayName,
            avatarUrl: nextAvatarUrl || undefined,
          }),
        })
        if (!res.ok) throw new Error("Update room profile failed")
      }

      onProfileSaved?.({ displayName: nextDisplayName, avatarUrl: nextAvatarUrl })
      toast({ title: t("settings.profileSavedTitle"), description: t("settings.profileSavedDesc") })
    } catch (e) {
      toast({
        title: t("settings.profileSaveFailedTitle"),
        description: e instanceof Error ? e.message : t("settings.profileSaveFailedDesc"),
        variant: "destructive",
      })
    } finally {
      setIsSavingProfile(false)
    }
  }

  const updatePassword = async () => {
    if (!user) {
      toast({ title: t("settings.notLoggedInTitle"), description: t("settings.notLoggedInDesc"), variant: "destructive" })
      return
    }

    const nextPassword = newPassword.trim()
    if (nextPassword.length < 6) {
      toast({ title: t("settings.passwordTooShortTitle"), description: t("settings.passwordTooShortDesc"), variant: "destructive" })
      return
    }
    if (nextPassword !== confirmPassword.trim()) {
      toast({ title: t("settings.passwordMismatchTitle"), description: t("settings.passwordMismatchDesc"), variant: "destructive" })
      return
    }

    setIsUpdatingPassword(true)
    try {
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.auth.updateUser({ password: nextPassword })
      if (error) throw error
      setNewPassword("")
      setConfirmPassword("")
      toast({ title: t("settings.passwordUpdatedTitle"), description: t("settings.passwordUpdatedDesc") })
    } catch (e) {
      toast({
        title: t("settings.updateFailedTitle"),
        description: e instanceof Error ? e.message : t("settings.updateFailedDesc"),
        variant: "destructive",
      })
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  const createPayOrder = async () => {
    if (!user) {
      toast({ title: t("settings.notLoggedInTitle"), description: t("settings.notLoggedInDesc"), variant: "destructive" })
      return
    }
    if (isCreatingPay) return
    setIsCreatingPay(true)
    try {
      const response = await fetch("/api/pay/alipay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCny: 9.9,
          subject: "MornSpeaker 会员月卡",
          userId: user.id,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.url) {
        throw new Error(data?.error || t("settings.payFailedDesc"))
      }
      const payloadUrl = String(data.url)
      if (payloadUrl.includes("<form")) {
        const target = window.open("", "_self")
        if (target) {
          target.document.open()
          target.document.write(payloadUrl)
          target.document.close()
        } else {
          document.open()
          document.write(payloadUrl)
          document.close()
        }
      } else {
        window.location.href = payloadUrl
      }
    } catch (e) {
      toast({
        title: t("settings.payFailedTitle"),
        description: e instanceof Error ? e.message : t("settings.payFailedDesc"),
        variant: "destructive",
      })
    } finally {
      setIsCreatingPay(false)
    }
  }

  const exportConversation = () => {
    const messages = localStorage.getItem("voicelink-messages")
    if (messages) {
      const blob = new Blob([messages], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `MornSpeaker-conversation-${new Date().toISOString()}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Settings className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="text-sm font-medium">{t("settings.account")}</div>
            <div className="space-y-2">
              <Label htmlFor="account-email">{t("settings.email")}</Label>
              <Input id="account-email" value={user?.email ?? ""} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-display-name">{t("settings.nickname")}</Label>
              <Input
                id="account-display-name"
                placeholder={t("settings.nicknamePlaceholder")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!user}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-avatar-url">{t("settings.avatar")}</Label>
              <Input
                id="account-avatar-url"
                placeholder={t("settings.avatarPlaceholder")}
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                disabled={!user}
              />
            </div>
            <Button className="w-full" onClick={saveProfile} disabled={!user || isSavingProfile}>
              {isSavingProfile ? t("settings.saving") : t("settings.saveAccount")}
            </Button>

            <div className="pt-4 border-t border-border space-y-2">
              <div className="text-sm font-medium">{t("settings.password")}</div>
              <div className="space-y-2">
                <Label htmlFor="account-new-password">{t("settings.newPassword")}</Label>
                <Input
                  id="account-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={!user}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-confirm-password">{t("settings.confirmPassword")}</Label>
                <Input
                  id="account-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={!user}
                />
              </div>
              <Button className="w-full" variant="outline" onClick={updatePassword} disabled={!user || isUpdatingPassword}>
                {isUpdatingPassword ? t("settings.updatingPassword") : t("settings.updatePassword")}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {settings.darkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              <Label htmlFor="dark-mode">{t("settings.darkMode")}</Label>
            </div>
            <Switch
              id="dark-mode"
              checked={settings.darkMode}
              onCheckedChange={(checked) => updateSetting("darkMode", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4" />
              <Label htmlFor="auto-play">{t("settings.autoPlay")}</Label>
            </div>
            <Switch
              id="auto-play"
              checked={settings.autoPlayTranslations}
              onCheckedChange={(checked) => updateSetting("autoPlayTranslations", checked)}
            />
          </div>

          <div className="space-y-2">
            <Label>
              {t("settings.speechRate")}: {settings.speechRate.toFixed(1)}x
            </Label>
            <Slider
              value={[settings.speechRate]}
              onValueChange={([value]) => updateSetting("speechRate", value)}
              min={0.5}
              max={2.0}
              step={0.1}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label>
              {t("settings.speechVolume")}: {Math.round(settings.speechVolume * 100)}%
            </Label>
            <Slider
              value={[settings.speechVolume]}
              onValueChange={([value]) => updateSetting("speechVolume", value)}
              min={0}
              max={1}
              step={0.1}
              className="w-full"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="save-history">{t("settings.saveHistory")}</Label>
            <Switch
              id="save-history"
              checked={settings.saveHistory}
              onCheckedChange={(checked) => updateSetting("saveHistory", checked)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              <Label>{t("settings.platform")}</Label>
            </div>
            <Select
              value={settings.platform}
              onValueChange={(value) => updateSetting("platform", value as AppSettings["platform"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="web">{t("settings.platform.web")}</SelectItem>
                <SelectItem value="wechat">{t("settings.platform.wechat")}</SelectItem>
                <SelectItem value="android">{t("settings.platform.android")}</SelectItem>
                <SelectItem value="ios">{t("settings.platform.ios")}</SelectItem>
                <SelectItem value="desktop">{t("settings.platform.desktop")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4 border-t border-border">
            <Button variant="outline" className="w-full gap-2 bg-transparent" onClick={exportConversation}>
              <Download className="w-4 h-4" />
              {t("settings.export")}
            </Button>
          </div>
          {isTencent ? (
            <div className="pt-4 border-t border-border space-y-3">
              <div className="text-sm font-medium">{t("settings.billing")}</div>
              <div className="text-sm text-muted-foreground">{t("settings.billingDesc")}</div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">{t("settings.billingPrice")}</div>
                <Button onClick={createPayOrder} disabled={!user || isCreatingPay}>
                  {isCreatingPay ? t("settings.payCreating") : t("settings.payNow")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
