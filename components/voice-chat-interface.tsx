"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Header } from "@/components/header"
import { ChatArea } from "@/components/chat-area"
import { VoiceControls } from "@/components/voice-controls"
import { LanguageSelector } from "@/components/language-selector"
import { RoomJoin } from "@/components/room-join"
import { UserList, type User } from "@/components/user-list"
import { transcribeAudio, translateText } from "@/lib/audio-utils"
import { useToast } from "@/hooks/use-toast"
import type { AppSettings } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { LogOut, Copy, Check } from "lucide-react"
import { useAuth } from "@/components/auth-provider"

export type Language = {
  code: string
  name: string
  flag: string
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en-US", name: "English", flag: "🇺🇸" },
  { code: "zh-CN", name: "中文", flag: "🇨🇳" },
  { code: "ja-JP", name: "日本語", flag: "🇯🇵" },
  { code: "es-ES", name: "Español", flag: "🇪🇸" },
  { code: "fr-FR", name: "Français", flag: "🇫🇷" },
  { code: "de-DE", name: "Deutsch", flag: "🇩🇪" },
  { code: "ko-KR", name: "한국어", flag: "🇰🇷" },
  { code: "pt-BR", name: "Português", flag: "🇧🇷" },
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
<<<<<<< Updated upstream
  const pollIntervalRef = useRef<NodeJS.Timeout>()
=======
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const pollAbortControllerRef = useRef<AbortController | null>(null)
  const isPollingRef = useRef(false)
  const liveTranslateAbortControllerRef = useRef<AbortController | null>(null)
  const liveTranslateTimerRef = useRef<NodeJS.Timeout | null>(null)
  const liveTranslateCooldownUntilRef = useRef(0)
  const translateRateLimitStepRef = useRef(0)
  const lastLiveTranslatedTextRef = useRef("")
  const isInRoomRef = useRef(false)
  const roomIdRef = useRef("")
  const pollTargetLanguageCodeRef = useRef(userLanguage.code)
  const clearedAtRef = useRef<number>(0)
  const translateCacheRef = useRef<Map<string, string>>(new Map())
  const translateEnqueuedRef = useRef<Set<string>>(new Set())
  const translateRetryAfterByKeyRef = useRef<Map<string, number>>(new Map())
  const translateWorkerRunningRef = useRef(false)
  const translateQueueRef = useRef<
    Array<{
      key: string
      roomId: string
      messageId: string
      originalText: string
      originalLanguage: string
      targetLanguage: string
    }>
  >([])

  const [liveCaption, setLiveCaption] = useState<{
    userName: string
    userAvatar?: string
    originalText: string
    translatedText: string
    originalLanguage: string
    targetLanguage: string
  } | null>(null)

  isInRoomRef.current = isInRoom
  roomIdRef.current = roomId
  pollTargetLanguageCodeRef.current = userLanguage.code

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

  const enqueuePollTranslation = useCallback(
    (job: {
      key: string
      roomId: string
      messageId: string
      originalText: string
      originalLanguage: string
      targetLanguage: string
    }) => {
      if (translateCacheRef.current.has(job.key)) return
      if (translateEnqueuedRef.current.has(job.key)) return
      translateEnqueuedRef.current.add(job.key)
      translateQueueRef.current.push(job)
    },
    [],
  )

  const runTranslateWorker = useCallback(async () => {
    if (translateWorkerRunningRef.current) return
    translateWorkerRunningRef.current = true
    try {
      while (translateQueueRef.current.length > 0) {
        if (!isInRoomRef.current) break
        const job = translateQueueRef.current.pop()
        if (!job) break
        translateEnqueuedRef.current.delete(job.key)

        if (job.roomId !== roomIdRef.current) continue
        if (job.targetLanguage !== pollTargetLanguageCodeRef.current) continue
        if (translateCacheRef.current.has(job.key)) continue

        const now = Date.now()
        if (now < liveTranslateCooldownUntilRef.current) {
          await sleep(liveTranslateCooldownUntilRef.current - now)
        }

        try {
          const translated = await translateText(job.originalText, job.originalLanguage, job.targetLanguage)
          translateCacheRef.current.set(job.key, translated)
          translateRetryAfterByKeyRef.current.delete(job.key)
          translateRateLimitStepRef.current = 0
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== job.messageId) return m
              if (m.targetLanguage !== job.targetLanguage) return m
              return { ...m, translatedText: translated }
            }),
          )
        } catch (error) {
          const status = (error as { status?: number })?.status
          if (status === 429) {
            translateRateLimitStepRef.current = Math.min(6, translateRateLimitStepRef.current + 1)
            const backoffMs = 5000 * translateRateLimitStepRef.current
            const until = Date.now() + backoffMs
            liveTranslateCooldownUntilRef.current = until
            translateRetryAfterByKeyRef.current.set(job.key, until)
            translateQueueRef.current.unshift(job)
            break
          }
        }
      }
    } finally {
      translateWorkerRunningRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (liveTranslateTimerRef.current) clearTimeout(liveTranslateTimerRef.current)
      liveTranslateAbortControllerRef.current?.abort()
    }
  }, [])
>>>>>>> Stashed changes

  useEffect(() => {
    if (!isInRoom || !roomId || !roomUserId) return

    const pollRoom = async () => {
      try {
        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", roomId }),
        })

        const data = await response.json()
        if (data.success && data.room) {
          setUsers(data.room.users)

          // Update messages with translations for current user
<<<<<<< Updated upstream
          const newMessages = await Promise.all(
            data.room.messages.map(async (msg: any) => {
              const isCurrentUser = msg.userId === userId
              let translatedText = msg.originalText

              // Translate message to current user's target language if not from current user
              if (!isCurrentUser && msg.originalLanguage !== targetLanguage.name) {
                try {
                  translatedText = await translateText(msg.originalText, msg.originalLanguage, targetLanguage.name)
                } catch (error) {
                  console.error("[v0] Translation error:", error)
=======
          const displayLanguageCode = userLanguage.code
          const usersById = new Map(room.users.map((u) => [u.id, u]))
          const clearedAt = clearedAtRef.current
          const newMessages = room.messages
            .filter((msg) => {
              const ts = Date.parse(msg.timestamp)
              if (!Number.isFinite(ts)) return false
              return ts > clearedAt
            })
            .map((msg) => {
              const isCurrentUser = msg.userId === roomUserId
              const key = `${room.id}:${msg.id}:${displayLanguageCode}`

              let translatedText = msg.originalText
              if (msg.targetLanguage === displayLanguageCode && typeof msg.translatedText === "string" && msg.translatedText.length > 0) {
                translatedText = msg.translatedText
                translateCacheRef.current.set(key, translatedText)
              } else if (msg.originalLanguage === displayLanguageCode) {
                translatedText = msg.originalText
              } else {
                const cached = translateCacheRef.current.get(key)
                if (typeof cached === "string" && cached.length > 0) {
                  translatedText = cached
                } else {
                  const retryAfter = translateRetryAfterByKeyRef.current.get(key) ?? 0
                  if (Date.now() < retryAfter) {
                    translatedText = "（翻译稍后重试…）"
                  } else {
                    translatedText = "（翻译中…）"
                    enqueuePollTranslation({
                      key,
                      roomId: room.id,
                      messageId: msg.id,
                      originalText: msg.originalText,
                      originalLanguage: msg.originalLanguage,
                      targetLanguage: displayLanguageCode,
                    })
                  }
>>>>>>> Stashed changes
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
                userAvatar: users.find((u) => u.id === msg.userId)?.avatar,
              }
            }),
          )

          setMessages(newMessages)
        }
      } catch (error) {
        console.error("[v0] Poll error:", error)
      }
    }

    pollRoom()
    pollIntervalRef.current = setInterval(pollRoom, 2000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
<<<<<<< Updated upstream
  }, [isInRoom, roomId, userId, targetLanguage])
=======
  }, [enqueuePollTranslation, isInRoom, roomId, roomUserId, runTranslateWorker, userLanguage.code])
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
          sourceLanguage: userLanguage.name,
          targetLanguage: targetLanguage.name,
=======
          sourceLanguage: userLanguage.code,
          targetLanguage: userLanguage.code,
          avatarUrl: profile?.avatar_url ?? undefined,
>>>>>>> Stashed changes
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
          title: "Joined room",
          description: `Welcome to ${newRoomId}!`,
        })
      }
    } catch (error) {
      console.error("[v0] Join room error:", error)
      toast({
        title: "Error",
        description: "Failed to join room. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleLeaveRoom = useCallback(async () => {
    try {
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "leave",
          roomId,
          userId: roomUserId,
        }),
      })

      setIsInRoom(false)
      setRoomId("")
      setMessages([])
      setUsers([])
<<<<<<< Updated upstream
=======
      setRoomUserId("")
      setJoinedAuthUserId(null)
      setLiveCaption(null)
      translateQueueRef.current = []
      translateEnqueuedRef.current.clear()
      if (liveTranslateTimerRef.current) clearTimeout(liveTranslateTimerRef.current)
      liveTranslateAbortControllerRef.current?.abort()
>>>>>>> Stashed changes

      toast({
        title: "Left room",
        description: "You have disconnected from the chat.",
      })
    } catch (error) {
      console.error("[v0] Leave room error:", error)
    }
  }, [roomId, roomUserId, toast])

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
        title: "Copied!",
        description: "Room ID copied to clipboard",
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
      title: "Chat cleared",
      description: "All messages have been removed.",
    })
  }, [toast])

<<<<<<< Updated upstream
=======
  const scheduleLiveTranslation = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) {
        if (liveTranslateTimerRef.current) clearTimeout(liveTranslateTimerRef.current)
        liveTranslateAbortControllerRef.current?.abort()
        setLiveCaption(null)
        return
      }

      const avatar = users.find((u) => u.id === roomUserId)?.avatar
      setLiveCaption({
        userName,
        userAvatar: avatar,
        originalText: trimmed,
        translatedText: userLanguage.code === targetLanguage.code ? trimmed : "",
        originalLanguage: userLanguage.code,
        targetLanguage: targetLanguage.code,
      })

      if (userLanguage.code === targetLanguage.code) {
        if (liveTranslateTimerRef.current) clearTimeout(liveTranslateTimerRef.current)
        liveTranslateAbortControllerRef.current?.abort()
        return
      }

      if (Date.now() < liveTranslateCooldownUntilRef.current) {
        return
      }

      if (trimmed === lastLiveTranslatedTextRef.current) {
        return
      }

      if (liveTranslateTimerRef.current) clearTimeout(liveTranslateTimerRef.current)
      liveTranslateTimerRef.current = setTimeout(async () => {
        const controller = new AbortController()
        liveTranslateAbortControllerRef.current?.abort()
        liveTranslateAbortControllerRef.current = controller

        try {
          if (Date.now() < liveTranslateCooldownUntilRef.current) {
            return
          }
          const translated = await translateText(trimmed, userLanguage.code, targetLanguage.code, controller.signal)
          if (controller.signal.aborted) return
          lastLiveTranslatedTextRef.current = trimmed
          translateRateLimitStepRef.current = 0
          setLiveCaption((prev) => {
            if (!prev) return prev
            if (prev.originalText !== trimmed) return prev
            return { ...prev, translatedText: translated }
          })
        } catch (error) {
          if (controller.signal.aborted) return
          const status = (error as { status?: number })?.status
          if (status === 429) {
            translateRateLimitStepRef.current = Math.min(6, translateRateLimitStepRef.current + 1)
            liveTranslateCooldownUntilRef.current = Date.now() + 5000 * translateRateLimitStepRef.current
            setLiveCaption((prev) => {
              if (!prev) return prev
              if (prev.originalText !== trimmed) return prev
              return { ...prev, translatedText: "（翻译请求过于频繁，请稍后再试。）" }
            })
            return
          }
          const message = error instanceof Error ? error.message : "翻译失败"
          console.error("[v0] Live translation error:", error)
          setLiveCaption((prev) => {
            if (!prev) return prev
            if (prev.originalText !== trimmed) return prev
            return { ...prev, translatedText: `（${message}）` }
          })
        } finally {
          if (liveTranslateAbortControllerRef.current === controller) {
            liveTranslateAbortControllerRef.current = null
          }
        }
      }, 900)
    },
    [roomUserId, targetLanguage.code, userLanguage.code, userName, users],
  )

>>>>>>> Stashed changes
  const handleRecordingComplete = useCallback(
    async (audioBlob: Blob) => {
      console.log("[v0] Recording complete, blob size:", audioBlob.size)
      setIsProcessing(true)

      try {
        const audioUrl = URL.createObjectURL(audioBlob)

        const transcribedText = await transcribeAudio(audioBlob, userLanguage.name)
        console.log("[v0] Transcribed text:", transcribedText)

        const message = {
          id: Date.now().toString(),
          userId: roomUserId,
          userName,
          originalText: transcribedText,
          originalLanguage: userLanguage.name,
          timestamp: new Date().toISOString(),
          audioUrl,
        }

        await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "message",
            roomId,
            message,
          }),
        })

        toast({
          title: "Message sent",
          description: `Broadcasting in ${userLanguage.name}`,
        })
      } catch (error) {
        console.error("[v0] Processing error:", error)
        toast({
          title: "Error",
          description: "Failed to process your voice. Please try again.",
          variant: "destructive",
        })
      } finally {
        setIsProcessing(false)
      }
    },
<<<<<<< Updated upstream
    [userLanguage, roomId, userId, userName, toast],
=======
    [roomId, roomUserId, toast, userLanguage.code, userLanguage.name, userName, users],
  )

  const handleFinalTranscript = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      if (liveTranslateTimerRef.current) clearTimeout(liveTranslateTimerRef.current)
      liveTranslateAbortControllerRef.current?.abort()

      setIsProcessing(true)
      try {
        const translatedText = trimmed

        const message = {
          id: Date.now().toString(),
          userId: roomUserId,
          userName,
          originalText: trimmed,
          translatedText,
          originalLanguage: userLanguage.code,
          targetLanguage: userLanguage.code,
          timestamp: new Date().toISOString(),
        }

        setMessages((prev) => [
          ...prev,
          {
            id: message.id,
            userId: message.userId,
            userName: message.userName,
            originalText: message.originalText,
            translatedText: message.translatedText,
            originalLanguage: message.originalLanguage,
            targetLanguage: message.targetLanguage,
            timestamp: new Date(message.timestamp),
            isUser: true,
            userAvatar: users.find((u) => u.id === message.userId)?.avatar,
          },
        ])

        await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "message",
            roomId,
            message,
          }),
        })

        toast({
          title: "消息已发送",
          description: `正在以 ${userLanguage.name} 广播`,
        })
      } catch (error) {
        const status = (error as { status?: number })?.status
        if (status !== 429) {
          console.error("[v0] Final transcript error:", error)
        }
        toast({
          title: "出错了",
          description: error instanceof Error ? error.message : "处理你的语音失败，请重试。",
          variant: "destructive",
        })
      } finally {
        setIsProcessing(false)
        setLiveCaption(null)
      }
    },
    [roomId, roomUserId, toast, userLanguage.code, userLanguage.name, userName, users],
>>>>>>> Stashed changes
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

      <div className="flex-1 flex max-w-7xl w-full mx-auto px-4 py-6 gap-6 overflow-hidden">
        <div className="hidden lg:block w-64 flex-shrink-0">
          <UserList users={users} currentUserId={roomUserId} />
        </div>

        <div className="flex-1 flex flex-col gap-6 min-w-0">
          <div className="flex items-center justify-between gap-4 p-4 bg-card rounded-lg border border-border">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">Room ID</p>
              <p className="font-mono font-medium truncate">{roomId}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopyRoomId} className="gap-2 bg-transparent">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handleLeaveRoom} className="gap-2 bg-transparent">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Leave</span>
              </Button>
            </div>
          </div>

          <LanguageSelector
            userLanguage={userLanguage}
            targetLanguage={targetLanguage}
            onUserLanguageChange={setUserLanguage}
            onTargetLanguageChange={setTargetLanguage}
            onSwap={handleLanguageSwap}
          />

          <ChatArea
            messages={messages}
            speechRate={settings.speechRate}
            speechVolume={settings.speechVolume}
            autoPlay={settings.autoPlayTranslations}
          />

          <VoiceControls isProcessing={isProcessing} onRecordingComplete={handleRecordingComplete} />
        </div>
      </div>
    </div>
  )
}
