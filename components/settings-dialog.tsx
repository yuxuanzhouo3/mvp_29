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

type SettingsDialogProps = {
  onSettingsChange?: (settings: AppSettings) => void
}

export type AppSettings = {
  darkMode: boolean
  autoPlayTranslations: boolean
  speechRate: number
  speechVolume: number
  saveHistory: boolean
  platform: "web" | "wechat" | "android" | "ios" | "desktop"
}

export function SettingsDialog({ onSettingsChange }: SettingsDialogProps) {
  const { toast } = useToast()
  const { user, profile, updateProfile } = useAuth()

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
      const stored = window.localStorage.getItem("voicelink_display_name")
      if (typeof stored === "string" && stored.trim()) return stored.trim()
    }
    return profile?.display_name || user?.user_metadata?.full_name || user?.email || ""
  }, [profile?.display_name, user?.email, user?.user_metadata])

  const [displayName, setDisplayName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)

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
      toast({ title: "未登录", description: "请先登录后再修改账号信息。", variant: "destructive" })
      return
    }

    const nextDisplayName = displayName.trim()
    const nextAvatarUrl = avatarUrl.trim()

    if (!nextDisplayName) {
      toast({ title: "昵称不能为空", description: "请填写昵称后再保存。", variant: "destructive" })
      return
    }

    setIsSavingProfile(true)
    try {
      const patch: { display_name?: string; avatar_url?: string | null } = {}
      if (nextDisplayName !== (profile?.display_name ?? "")) patch.display_name = nextDisplayName
      if (nextAvatarUrl !== (profile?.avatar_url ?? "")) patch.avatar_url = nextAvatarUrl ? nextAvatarUrl : null

      if (Object.keys(patch).length > 0) {
        await updateProfile(patch)
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem("voicelink_display_name", nextDisplayName)
      }

      toast({ title: "已保存", description: "账号信息已更新。" })
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "请稍后重试。",
        variant: "destructive",
      })
    } finally {
      setIsSavingProfile(false)
    }
  }

  const updatePassword = async () => {
    if (!user) {
      toast({ title: "未登录", description: "请先登录后再修改密码。", variant: "destructive" })
      return
    }

    const nextPassword = newPassword.trim()
    if (nextPassword.length < 6) {
      toast({ title: "密码过短", description: "密码至少 6 位。", variant: "destructive" })
      return
    }
    if (nextPassword !== confirmPassword.trim()) {
      toast({ title: "两次密码不一致", description: "请确认两次输入的新密码相同。", variant: "destructive" })
      return
    }

    setIsUpdatingPassword(true)
    try {
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.auth.updateUser({ password: nextPassword })
      if (error) throw error
      setNewPassword("")
      setConfirmPassword("")
      toast({ title: "密码已更新", description: "请使用新密码重新登录。" })
    } catch (e) {
      toast({
        title: "修改密码失败",
        description: e instanceof Error ? e.message : "请稍后重试。",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  const exportConversation = () => {
    const messages = localStorage.getItem("voicelink-messages")
    if (messages) {
      const blob = new Blob([messages], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `voicelink-conversation-${new Date().toISOString()}.json`
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
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Customize your VoiceLink experience</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="text-sm font-medium">账号</div>
            <div className="space-y-2">
              <Label htmlFor="account-email">邮箱</Label>
              <Input id="account-email" value={user?.email ?? ""} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-display-name">昵称</Label>
              <Input
                id="account-display-name"
                placeholder="请输入昵称"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!user}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-avatar-url">头像链接（可选）</Label>
              <Input
                id="account-avatar-url"
                placeholder="https://..."
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                disabled={!user}
              />
            </div>
            <Button className="w-full" onClick={saveProfile} disabled={!user || isSavingProfile}>
              {isSavingProfile ? "保存中..." : "保存账号信息"}
            </Button>

            <div className="pt-4 border-t border-border space-y-2">
              <div className="text-sm font-medium">修改密码</div>
              <div className="space-y-2">
                <Label htmlFor="account-new-password">新密码</Label>
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
                <Label htmlFor="account-confirm-password">确认新密码</Label>
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
                {isUpdatingPassword ? "更新中..." : "更新密码"}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {settings.darkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              <Label htmlFor="dark-mode">Dark Mode</Label>
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
              <Label htmlFor="auto-play">Auto-play Translations</Label>
            </div>
            <Switch
              id="auto-play"
              checked={settings.autoPlayTranslations}
              onCheckedChange={(checked) => updateSetting("autoPlayTranslations", checked)}
            />
          </div>

          <div className="space-y-2">
            <Label>Speech Rate: {settings.speechRate.toFixed(1)}x</Label>
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
            <Label>Speech Volume: {Math.round(settings.speechVolume * 100)}%</Label>
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
            <Label htmlFor="save-history">Save Conversation History</Label>
            <Switch
              id="save-history"
              checked={settings.saveHistory}
              onCheckedChange={(checked) => updateSetting("saveHistory", checked)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              <Label>Platform</Label>
            </div>
            <Select value={settings.platform} onValueChange={(value: any) => updateSetting("platform", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="web">Web</SelectItem>
                <SelectItem value="wechat">WeChat Mini Program</SelectItem>
                <SelectItem value="android">Android</SelectItem>
                <SelectItem value="ios">iOS</SelectItem>
                <SelectItem value="desktop">Desktop</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4 border-t border-border">
            <Button variant="outline" className="w-full gap-2 bg-transparent" onClick={exportConversation}>
              <Download className="w-4 h-4" />
              Export Conversation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
