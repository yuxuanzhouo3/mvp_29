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
import { useState, useEffect } from "react"

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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Customize your VoiceLink experience</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
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
