"use client"

import { Mic2, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SettingsDialog, type AppSettings } from "@/components/settings-dialog"

type HeaderProps = {
  onClearChat?: () => void
  messageCount?: number
  onSettingsChange?: (settings: AppSettings) => void
  roomId?: string
  userCount?: number
}

export function Header({ onClearChat, messageCount = 0, onSettingsChange, roomId, userCount }: HeaderProps) {
  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Mic2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">VoiceLink</h1>
            <p className="text-sm text-muted-foreground">
              {roomId ? (
                <span className="flex items-center gap-2">
                  <Users className="w-3 h-3" />
                  {userCount} {userCount === 1 ? "user" : "users"} connected
                  {messageCount > 0 && ` • ${messageCount} ${messageCount === 1 ? "message" : "messages"}`}
                </span>
              ) : messageCount > 0 ? (
                `${messageCount} message${messageCount !== 1 ? "s" : ""}`
              ) : (
                "Real-time Voice Translation"
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {messageCount > 0 && onClearChat && (
            <Button variant="ghost" size="sm" onClick={onClearChat} className="gap-2">
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Clear Chat</span>
            </Button>
          )}
          <SettingsDialog onSettingsChange={onSettingsChange} />
        </div>
      </div>
    </header>
  )
}
