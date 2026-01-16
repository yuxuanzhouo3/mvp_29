"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Header } from "@/components/header"
import { ChatArea } from "@/components/chat-area"
import { VoiceControls } from "@/components/voice-controls"
import { LanguageSelector } from "@/components/language-selector"
import { RoomJoin } from "@/components/room-join"
import { UserList, type User } from "@/components/user-list"
import { AdSlot } from "@/components/ad-slot"
import { transcribeAudio, translateText } from "@/lib/audio-utils"
import { useToast } from "@/hooks/use-toast"
import type { AppSettings } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { LogOut, Copy, Check } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useI18n } from "@/components/i18n-provider"

export type Language = {
  code: string
  name: string
  flag: string
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en-US", name: "英语", flag: "🇺🇸" },
  { code: "zh-CN", name: "中文", flag: "🇨🇳" },
  { code: "ja-JP", name: "日语", flag: "🇯🇵" },
  { code: "es-ES", name: "西班牙语", flag: "🇪🇸" },
  { code: "fr-FR", name: "法语", flag: "🇫🇷" },
  { code: "de-DE", name: "德语", flag: "🇩🇪" },
  { code: "ko-KR", name: "韩语", flag: "🇰🇷" },
  { code: "pt-BR", name: "葡萄牙语", flag: "🇧🇷" },
]

export type Message = {
  id: string
  userId: string
  userName: string
  originalText: string
  translatedText: string
  originalLanguage: string
  targetLanguage: string
  timestamp: Date
  isUser: boolean
  audioUrl?: string
  userAvatar?: string
}

export function VoiceChatInterface() {
  const { profile, user } = useAuth()
  const { t } = useI18n()
  const [isInRoom, setIsInRoom] = useState(false)
  const [roomId, setRoomId] = useState("")
  const [anonUserId] = useState(() => `user-${Math.random().toString(36).substring(2, 11)}`)
  const [roomUserId, setRoomUserId] = useState("")
  const [joinedAuthUserId, setJoinedAuthUserId] = useState<string | null>(null)
  const clientInstanceIdRef = useRef("")
  const [userName, setUserName] = useState("")
  const [users, setUsers] = useState<User[]>([])
  const [copied, setCopied] = useState(false)

  const [messages, setMessages] = useState<Message[]>([])
  const [userLanguage, setUserLanguage] = useState<Language>(SUPPORTED_LANGUAGES[0])
  const [targetLanguage, setTargetLanguage] = useState<Language>(SUPPORTED_LANGUAGES[1])
  const [isProcessing, setIsProcessing] = useState(false)
  const [settings, setSettings] = useState<AppSettings>({
    darkMode: false,
    autoPlayTranslations: false,
    speechRate: 0.9,
    speechVolume: 1.0,
    saveHistory: true,
    platform: "web",
  })
  const { toast } = useToast()
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const translationCacheRef = useRef<Map<string, string>>(new Map())

  const ensureClientInstanceId = useCallback(() => {
    if (clientInstanceIdRef.current) return clientInstanceIdRef.current
    if (typeof window === "undefined") {
      const fallback = `ci-${Math.random().toString(36).substring(2, 11)}`
      clientInstanceIdRef.current = fallback
      return fallback
    }

    const storageKey = "voicelink_client_instance_id"
    const existing = window.sessionStorage.getItem(storageKey)
    if (existing) {
      clientInstanceIdRef.current = existing
      return existing
    }

    const created =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `ci-${Math.random().toString(36).substring(2, 11)}`
    window.sessionStorage.setItem(storageKey, created)
    clientInstanceIdRef.current = created
    return created
  }, [])

  const exitRoom = useCallback(
    (title: string, description: string) => {
      setIsInRoom(false)
      setRoomId("")
      setMessages([])
      setUsers([])
      setRoomUserId("")
      setJoinedAuthUserId(null)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      translationCacheRef.current.clear()
      toast({ title, description })
    },
    [toast],
  )

  useEffect(() => {
    if (!isInRoom || !roomId || !roomUserId) return
    const cache = translationCacheRef.current

    const pollRoom = async () => {
      try {
        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", roomId }),
        })

        if (response.status === 410) {
          exitRoom(t("toast.expiredTitle"), t("toast.expiredDesc"))
          return
        }

        const data = (await response.json().catch(() => null)) as
          | { success?: boolean; room?: { users: User[]; messages: Array<{ id: string; userId: string; userName: string; originalText: string; originalLanguage: string; timestamp: string; audioUrl?: string }> } }
          | null
        if (!data?.success || !data.room) return

        const room = data.room
        setUsers(room.users)

        const avatarById = new Map(room.users.map((u) => [u.id, u.avatar]))
        const newMessages = await Promise.all(
          room.messages.map(async (msg) => {
            const cacheKey = `${msg.id}:${targetLanguage.name}`
            const cached = cache.get(cacheKey)

            const isCurrentUser = msg.userId === roomUserId
            let translatedText = msg.originalText

            if (typeof cached === "string" && cached.length > 0) {
              translatedText = cached
            } else if (msg.originalLanguage !== targetLanguage.name) {
              try {
                translatedText = await translateText(msg.originalText, msg.originalLanguage, targetLanguage.name)
                cache.set(cacheKey, translatedText)
              } catch (error) {
                console.error("[v0] Translation error:", error)
              }
            }

            return {
              id: msg.id,
              userId: msg.userId,
              userName: msg.userName,
              originalText: msg.originalText,
              translatedText,
              originalLanguage: msg.originalLanguage,
              targetLanguage: targetLanguage.name,
              timestamp: new Date(msg.timestamp),
              isUser: isCurrentUser,
              audioUrl: msg.audioUrl,
              userAvatar: avatarById.get(msg.userId),
            }
          }),
        )

        setMessages(newMessages)
      } catch (error) {
        console.error("[v0] Poll error:", error)
      }
    }

    void pollRoom()
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    pollIntervalRef.current = setInterval(() => {
      void pollRoom()
    }, 2000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      cache.clear()
    }
  }, [exitRoom, isInRoom, roomId, roomUserId, t, targetLanguage.name])

  const handleJoinRoom = async (newRoomId: string, newUserName: string) => {
    try {
      const participantId = user?.id ? `${user.id}:${ensureClientInstanceId()}` : anonUserId
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          roomId: newRoomId,
          userId: participantId,
          userName: newUserName,
          sourceLanguage: userLanguage.name,
          targetLanguage: targetLanguage.name,
          avatarUrl: profile?.avatar_url ?? undefined,
        }),
      })

      const data = await response.json()
      if (data.success) {
        setRoomId(newRoomId)
        setUserName(newUserName)
        setRoomUserId(participantId)
        setJoinedAuthUserId(user?.id ?? null)
        setIsInRoom(true)
        setUsers(data.room.users)
        toast({
          title: t("toast.joinedTitle"),
          description: t("toast.joinedDesc", { roomId: newRoomId }),
        })
      }
    } catch (error) {
      console.error("[v0] Join room error:", error)
      toast({
        title: t("toast.errorTitle"),
        description: t("toast.joinFailed"),
        variant: "destructive",
      })
    }
  }

  const handleLeaveRoom = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "leave",
          roomId,
          userId: roomUserId,
        }),
      })
      if (res.status === 410) {
        exitRoom(t("toast.expiredTitle"), t("toast.expiredDesc"))
        return
      }
      exitRoom(t("toast.leftTitle"), t("toast.leftDesc"))
    } catch (error) {
      console.error("[v0] Leave room error:", error)
    }
  }, [exitRoom, roomId, roomUserId, t])

  useEffect(() => {
    if (!isInRoom) return
    if (!joinedAuthUserId) return
    if (!user?.id) return
    if (user.id === joinedAuthUserId) return
    void handleLeaveRoom()
  }, [handleLeaveRoom, isInRoom, joinedAuthUserId, user?.id])

  const handleCopyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: t("toast.copiedTitle"),
        description: t("toast.copiedDesc"),
      })
    } catch (error) {
      console.error("[v0] Copy error:", error)
    }
  }

  const handleLanguageSwap = () => {
    setUserLanguage(targetLanguage)
    setTargetLanguage(userLanguage)
  }

  const handleClearChat = useCallback(() => {
    setMessages([])
    toast({
      title: t("toast.chatClearedTitle"),
      description: t("toast.chatClearedDesc"),
    })
  }, [t, toast])
  const handleRecordingComplete = useCallback(
    async (audioBlob: Blob) => {
      console.log("[v0] Recording complete, blob size:", audioBlob.size)
      setIsProcessing(true)

      try {
        const audioUrl = URL.createObjectURL(audioBlob)

        const transcribedText = await transcribeAudio(audioBlob, userLanguage.code)
        console.log("[v0] Transcribed text:", transcribedText)

        const message = {
          id: Date.now().toString(),
          userId: roomUserId,
          userName,
          originalText: transcribedText,
          originalLanguage: userLanguage.name,
          targetLanguage: targetLanguage.name,
          timestamp: new Date().toISOString(),
          audioUrl,
        }

        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "message",
            roomId,
            message,
          }),
        })

        if (res.status === 410) {
          exitRoom(t("toast.expiredTitle"), t("toast.expiredDesc"))
          return
        }
        if (!res.ok) {
          throw new Error("Send message failed")
        }

        toast({
          title: t("toast.sentTitle"),
          description: t("toast.sentDesc", { language: userLanguage.name }),
        })
      } catch (error) {
        console.error("[v0] Processing error:", error)
        toast({
          title: t("toast.errorTitle"),
          description: t("toast.processFailed"),
          variant: "destructive",
        })
      } finally {
        setIsProcessing(false)
      }
    },
    [exitRoom, roomId, roomUserId, t, targetLanguage.name, toast, userLanguage.code, userLanguage.name, userName],
  )

  if (!isInRoom) {
    return <RoomJoin onJoin={handleJoinRoom} />
  }

  return (
    <div className="flex flex-col h-screen">
      <Header
        onClearChat={handleClearChat}
        messageCount={messages.length}
        onSettingsChange={setSettings}
        roomId={isInRoom ? roomId : undefined}
        userCount={users.length}
      />

      <div className="flex-1 flex max-w-screen-2xl w-full mx-auto px-4 py-4 gap-4 overflow-hidden min-h-0">
        <div className="hidden lg:flex w-64 flex-shrink-0 flex-col gap-4">
          <div className="min-h-0 flex-1">
            <UserList users={users} currentUserId={roomUserId} />
          </div>
          <AdSlot slotKey="room_sidebar" variant="sidebar" limit={2} fetchLimit={6} rotateMs={7000} />
        </div>

        <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
          <div className="lg:hidden">
            <AdSlot slotKey="room_inline" variant="inline" limit={1} />
          </div>

          <div className="flex-1 min-h-0 bg-card rounded-xl border border-border overflow-hidden flex flex-col">
            <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">{t("common.roomId")}</div>
                <div className="font-mono text-sm font-medium truncate">{roomId}</div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopyRoomId}
                className="h-9 w-9 shrink-0"
                aria-label={copied ? t("common.copied") : t("common.copy")}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLeaveRoom}
                className="h-9 w-9 shrink-0"
                aria-label={t("common.leave")}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>

            <div className="shrink-0 px-3 py-2 border-b border-border">
              <LanguageSelector
                variant="compact"
                userLanguage={userLanguage}
                targetLanguage={targetLanguage}
                onUserLanguageChange={setUserLanguage}
                onTargetLanguageChange={setTargetLanguage}
                onSwap={handleLanguageSwap}
              />
            </div>

            <ChatArea
              variant="embedded"
              messages={messages}
              speechRate={settings.speechRate}
              speechVolume={settings.speechVolume}
              autoPlay={settings.autoPlayTranslations}
            />

            <div className="shrink-0 px-3 py-2 border-t border-border bg-background/50">
              <VoiceControls variant="inline" isProcessing={isProcessing} onRecordingComplete={handleRecordingComplete} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
