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
import { LogOut, Copy, Check, Settings, Users } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useI18n } from "@/components/i18n-provider"
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export type Language = {
  code: string
  name: string
  flag: string
}

type SpeechRecognitionAlternativeLike = { transcript: string }
type SpeechRecognitionResultLike = { length: number;[index: number]: SpeechRecognitionAlternativeLike }
type SpeechRecognitionResultListLike = { length: number;[index: number]: SpeechRecognitionResultLike }
type SpeechRecognitionEventLike = { results: SpeechRecognitionResultListLike }
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

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

type RoomSettings = { adminUserId: string; joinMode: "public" | "password" } | null

export function VoiceChatInterface() {
  const { profile, user, updateUserMetadata } = useAuth()
  const { t, locale } = useI18n()
  const [isInRoom, setIsInRoom] = useState(false)
  const [roomId, setRoomId] = useState("")
  const [anonUserId] = useState(() => {
    const fallback = `user-${Math.random().toString(36).substring(2, 11)}`
    if (typeof window === "undefined") return fallback
    const storageKey = "voicelink_anon_user_id"
    const existing = window.localStorage.getItem(storageKey)
    if (existing) return existing
    window.localStorage.setItem(storageKey, fallback)
    return fallback
  })
  const [roomUserId, setRoomUserId] = useState("")
  const [joinedAuthUserId, setJoinedAuthUserId] = useState<string | null>(null)
  const clientInstanceIdRef = useRef("")
  const [userName, setUserName] = useState("")
  const [users, setUsers] = useState<User[]>([])
  const [roomSettings, setRoomSettings] = useState<RoomSettings>(null)
  const [copied, setCopied] = useState(false)

  const [messages, setMessages] = useState<Message[]>([])
  const [userLanguage, setUserLanguage] = useState<Language>(SUPPORTED_LANGUAGES[0])
  const [isRecording, setIsRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [liveTranslation, setLiveTranslation] = useState("")
  const [liveSpeechSupported, setLiveSpeechSupported] = useState(true)
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
  const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const pollInFlightRef = useRef(false)
  const pollFailureCountRef = useRef(0)
  const translationCacheRef = useRef<Map<string, string>>(new Map())
  const leaveInitiatedRef = useRef(false)
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false)
  const [roomSettingsJoinMode, setRoomSettingsJoinMode] = useState<"public" | "password">("public")
  const [roomSettingsPassword, setRoomSettingsPassword] = useState("")
  const [roomSettingsSaving, setRoomSettingsSaving] = useState(false)
  const [isUsersSheetOpen, setIsUsersSheetOpen] = useState(false)
  const languagePrefsInitKeyRef = useRef<string | null>(null)
  const lastSavedLanguagePrefsRef = useRef<{ userKey: string; source: string } | null>(null)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const liveTranslateAbortRef = useRef<AbortController | null>(null)
  const liveTranslateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resolveLanguageCode = useCallback((value: string): string => {
    const byCode = SUPPORTED_LANGUAGES.find((l) => l.code === value)
    if (byCode) return byCode.code
    const byName = SUPPORTED_LANGUAGES.find((l) => l.name === value)
    if (byName) return byName.code
    return value
  }, [])

  const uiLocaleToLanguageCode = useCallback((): string => {
    if (locale === "zh") return "zh-CN"
    if (locale === "ja") return "ja-JP"
    return "en-US"
  }, [locale])

  const primaryOf = useCallback((code: string) => {
    const raw = typeof code === "string" ? code.trim() : ""
    const normalized = raw.replaceAll("_", "-")
    return (normalized.split("-")[0] ?? normalized).toLowerCase()
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!isInRoom) return

    if (!isRecording) {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.onresult = null
          speechRecognitionRef.current.onerror = null
          speechRecognitionRef.current.onend = null
          speechRecognitionRef.current.stop()
        } catch { }
        speechRecognitionRef.current = null
      }
      return
    }

    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
      mozSpeechRecognition?: SpeechRecognitionConstructor
    }
    const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? w.mozSpeechRecognition
    if (!SpeechRecognition) {
      setLiveSpeechSupported(false)
      return
    }
    setLiveSpeechSupported(true)

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = userLanguage.code

    recognition.onresult = (event) => {
      try {
        const results = event.results
        if (!results || typeof results.length !== "number") return
        let text = ""
        for (let i = 0; i < results.length; i += 1) {
          const item = results[i]
          const alt = item?.[0]
          const part = typeof alt?.transcript === "string" ? alt.transcript : ""
          if (part) text += part
        }
        const trimmed = text.trim()
        if (trimmed) setLiveTranscript(trimmed)
      } catch { }
    }

    recognition.onerror = () => {
      setLiveSpeechSupported(false)
    }

    recognition.onend = () => {
      if (!isRecording) return
      try {
        recognition.start()
      } catch { }
    }

    speechRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      setLiveSpeechSupported(false)
    }

    return () => {
      try {
        recognition.onresult = null
        recognition.onerror = null
        recognition.onend = null
        recognition.stop()
      } catch { }
      if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null
    }
  }, [isInRoom, isRecording, userLanguage.code])

  useEffect(() => {
    if (!isInRoom) return
    const sourceCode = userLanguage.code
    const targetCode = uiLocaleToLanguageCode()
    const sourcePrimary = primaryOf(sourceCode)
    const targetPrimary = primaryOf(targetCode)

    if (liveTranslateTimerRef.current) {
      clearTimeout(liveTranslateTimerRef.current)
      liveTranslateTimerRef.current = null
    }

    if (!liveTranscript.trim()) {
      setLiveTranslation("")
      return
    }

    if (sourcePrimary === targetPrimary) {
      setLiveTranslation(liveTranscript)
      return
    }

    liveTranslateTimerRef.current = setTimeout(() => {
      if (liveTranslateAbortRef.current) liveTranslateAbortRef.current.abort()
      const controller = new AbortController()
      liveTranslateAbortRef.current = controller

      void translateText(liveTranscript, sourceCode, targetCode, controller.signal)
        .then((translated) => {
          if (!controller.signal.aborted) setLiveTranslation(translated)
        })
        .catch(() => { })
        .finally(() => {
          if (liveTranslateAbortRef.current === controller) liveTranslateAbortRef.current = null
        })
    }, 800)

    return () => {
      if (liveTranslateTimerRef.current) {
        clearTimeout(liveTranslateTimerRef.current)
        liveTranslateTimerRef.current = null
      }
      if (liveTranslateAbortRef.current) {
        liveTranslateAbortRef.current.abort()
        liveTranslateAbortRef.current = null
      }
    }
  }, [isInRoom, liveTranscript, primaryOf, uiLocaleToLanguageCode, userLanguage.code])

  useEffect(() => {
    const userKey = user?.id ?? "anon"
    if (languagePrefsInitKeyRef.current === userKey) return
    languagePrefsInitKeyRef.current = userKey

    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
    const rawSource =
      (meta.sourceLanguageCode as unknown) ??
      (meta.source_language_code as unknown) ??
      (meta.sourceLanguage as unknown) ??
      (meta.source_language as unknown)

    const readLocal = (key: string) => {
      if (typeof window === "undefined") return null
      const value = window.localStorage.getItem(key)
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed ? trimmed : null
    }

    const localSource =
      readLocal(`voicelink_source_language:${userKey}`) ??
      (userKey !== "anon" ? readLocal("voicelink_source_language") : null) ??
      readLocal("voicelink_source_language:anon")

    const resolvedSource =
      typeof rawSource === "string" ? resolveLanguageCode(rawSource) : localSource ? resolveLanguageCode(localSource) : null

    const nextSource = resolvedSource ? SUPPORTED_LANGUAGES.find((l) => l.code === resolvedSource) : null
    if (nextSource) setUserLanguage(nextSource)
  }, [resolveLanguageCode, user?.id, user?.user_metadata])

  useEffect(() => {
    const userKey = user?.id ?? "anon"

    if (typeof window !== "undefined") {
      window.localStorage.setItem(`voicelink_source_language:${userKey}`, userLanguage.code)
      if (userKey === "anon") {
        window.localStorage.setItem("voicelink_source_language", userLanguage.code)
      }
    }

    if (!user) return
    const last = lastSavedLanguagePrefsRef.current
    if (last && last.userKey === userKey && last.source === userLanguage.code) return
    lastSavedLanguagePrefsRef.current = { userKey, source: userLanguage.code }
    void updateUserMetadata({ sourceLanguageCode: userLanguage.code }).catch((error) => {
      console.error("[v0] Save language prefs failed:", error)
    })
  }, [updateUserMetadata, user, userLanguage.code])

  const ensureClientInstanceId = useCallback(() => {
    if (clientInstanceIdRef.current) return clientInstanceIdRef.current
    if (typeof window === "undefined") {
      const fallback = `ci-${Math.random().toString(36).substring(2, 11)}`
      clientInstanceIdRef.current = fallback
      return fallback
    }

    const storageKey = "voicelink_client_instance_id"
    const existing = window.localStorage.getItem(storageKey)
    if (existing) {
      clientInstanceIdRef.current = existing
      return existing
    }

    const created =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `ci-${Math.random().toString(36).substring(2, 11)}`
    window.localStorage.setItem(storageKey, created)
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
      setRoomSettings(null)
      leaveInitiatedRef.current = false
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      if (pollAbortRef.current) {
        pollAbortRef.current.abort()
        pollAbortRef.current = null
      }
      pollInFlightRef.current = false
      pollFailureCountRef.current = 0
      translationCacheRef.current.clear()
      toast({ title, description })
    },
    [toast],
  )

  useEffect(() => {
    if (!isInRoom || !roomId || !roomUserId) return
    const cache = translationCacheRef.current
    let cancelled = false

    const clearPolling = () => {
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      if (pollAbortRef.current) {
        pollAbortRef.current.abort()
        pollAbortRef.current = null
      }
      pollInFlightRef.current = false
    }

    const schedulePoll = (delayMs: number) => {
      if (cancelled) return
      if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current)
      pollIntervalRef.current = setTimeout(() => {
        void pollRoom()
      }, delayMs)
    }

    const pollRoom = async () => {
      if (cancelled) return
      if (pollInFlightRef.current) {
        schedulePoll(2000)
        return
      }
      pollInFlightRef.current = true
      let shouldSchedule = true
      let nextDelayMs = 2000
      try {
        const controller = new AbortController()
        if (pollAbortRef.current) pollAbortRef.current.abort()
        pollAbortRef.current = controller

        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", roomId }),
          cache: "no-store",
          signal: controller.signal,
        })

        if (response.status === 410) {
          shouldSchedule = false
          exitRoom(t("toast.expiredTitle"), t("toast.expiredDesc"))
          return
        }
        if (response.status === 404) {
          shouldSchedule = false
          exitRoom(t("toast.roomUnavailableTitle"), t("toast.roomUnavailableDesc"))
          return
        }
        if (!response.ok) {
          throw new Error(`Poll failed with status ${response.status}`)
        }

        const data = (await response.json().catch(() => null)) as
          | {
            success?: boolean
            room?: {
              users: User[]
              messages: Array<{ id: string; userId: string; userName: string; originalText: string; originalLanguage: string; timestamp: string; audioUrl?: string }>
            }
            settings?: { adminUserId?: string; joinMode?: "public" | "password" } | null
          }
          | null
        if (!data?.success || !data.room) {
          throw new Error("Invalid poll response")
        }

        const room = data.room
        const nextSettings =
          data.settings && typeof data.settings.adminUserId === "string"
            ? ({ adminUserId: data.settings.adminUserId, joinMode: data.settings.joinMode === "password" ? "password" : "public" } as const)
            : null
        if (nextSettings) setRoomSettings(nextSettings)
        setUsers(room.users)
        if (!leaveInitiatedRef.current && !room.users.some((u) => u.id === roomUserId)) {
          shouldSchedule = false
          exitRoom(t("toast.kickedTitle"), t("toast.kickedDesc"))
          return
        }

        const avatarById = new Map(room.users.map((u) => [u.id, u.avatar]))
        const newMessages = await Promise.all(
          room.messages.map(async (msg) => {
            const sourceLanguageCode = resolveLanguageCode(msg.originalLanguage)
            const targetLanguageCode = userLanguage.code
            const cacheKey = `${msg.id}:${targetLanguageCode}`
            const cached = cache.get(cacheKey)

            const isCurrentUser = msg.userId === roomUserId
            let translatedText = msg.originalText

            if (typeof cached === "string" && cached.length > 0) {
              translatedText = cached
            } else if (sourceLanguageCode !== targetLanguageCode) {
              try {
                translatedText = await translateText(msg.originalText, sourceLanguageCode, targetLanguageCode)
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
              originalLanguage: sourceLanguageCode,
              targetLanguage: targetLanguageCode,
              timestamp: new Date(msg.timestamp),
              isUser: isCurrentUser,
              audioUrl: msg.audioUrl,
              userAvatar: avatarById.get(msg.userId),
            }
          }),
        )

        setMessages(newMessages)
        pollFailureCountRef.current = 0
      } catch (error) {
        if (cancelled) return
        if (error instanceof DOMException && error.name === "AbortError") {
          shouldSchedule = false
          return
        }
        const nextFailures = pollFailureCountRef.current + 1
        pollFailureCountRef.current = nextFailures
        const exp = Math.min(4, Math.max(0, nextFailures - 1))
        nextDelayMs = Math.min(30_000, 2000 * 2 ** exp)
      } finally {
        pollInFlightRef.current = false
        if (shouldSchedule) schedulePoll(nextDelayMs)
      }
    }

    void pollRoom()

    return () => {
      cancelled = true
      clearPolling()
      cache.clear()
    }
  }, [exitRoom, isInRoom, resolveLanguageCode, roomId, roomUserId, t, userLanguage.code])

  const handleJoinRoom = async (
    newRoomId: string,
    newUserName: string,
    options?: { joinPassword?: string; createJoinMode?: "public" | "password"; createPassword?: string },
  ): Promise<{ success: boolean; needsPassword?: boolean }> => {
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
          targetLanguage: userLanguage.name,
          avatarUrl: profile?.avatar_url ?? undefined,
          joinPassword: options?.joinPassword,
          createJoinMode: options?.createJoinMode,
          createPassword: options?.createPassword,
        }),
      })

      const data = (await response.json().catch(() => null)) as
        | { success?: boolean; room?: { users: User[] }; settings?: { adminUserId?: string; joinMode?: "public" | "password" } | null; error?: string }
        | null
      if (!response.ok || !data?.success || !data.room) {
        if (response.status === 401) {
          toast({
            title: t("toast.errorTitle"),
            description: options?.joinPassword ? t("toast.passwordInvalid") : t("toast.passwordRequired"),
            variant: "destructive",
          })
          return { success: false, needsPassword: true }
        }
        toast({
          title: t("toast.errorTitle"),
          description: data?.error ? String(data.error) : t("toast.joinFailed"),
          variant: "destructive",
        })
        return { success: false }
      }
      if (data.success) {
        leaveInitiatedRef.current = false
        setRoomId(newRoomId)
        setUserName(newUserName)
        setRoomUserId(participantId)
        setJoinedAuthUserId(user?.id ?? null)
        setIsInRoom(true)
        setUsers(data.room.users)
        const nextSettings =
          data.settings && typeof data.settings.adminUserId === "string"
            ? ({ adminUserId: data.settings.adminUserId, joinMode: data.settings.joinMode === "password" ? "password" : "public" } as const)
            : null
        setRoomSettings(nextSettings)
        toast({
          title: t("toast.joinedTitle"),
          description: t("toast.joinedDesc", { roomId: newRoomId }),
        })
        return { success: true }
      }
      return { success: false }
    } catch (error) {
      console.error("[v0] Join room error:", error)
      toast({
        title: t("toast.errorTitle"),
        description: t("toast.joinFailed"),
        variant: "destructive",
      })
      return { success: false }
    }
  }

  const handleKickUser = useCallback(
    async (targetUserId: string) => {
      try {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "kick", roomId, userId: roomUserId, targetUserId }),
        })
        if (res.status === 410) {
          exitRoom(t("toast.expiredTitle"), t("toast.expiredDesc"))
          return
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          toast({
            title: t("toast.errorTitle"),
            description: data?.error ? String(data.error) : t("toast.kickFailed"),
            variant: "destructive",
          })
          return
        }
        toast({ title: t("toast.kickSuccessTitle"), description: t("toast.kickSuccessDesc") })
      } catch {
        toast({ title: t("toast.errorTitle"), description: t("toast.kickFailed"), variant: "destructive" })
      }
    },
    [exitRoom, roomId, roomUserId, t, toast],
  )

  const isAdmin = Boolean(roomSettings && roomSettings.adminUserId === roomUserId)

  const openRoomSettings = () => {
    const nextMode = roomSettings?.joinMode ?? "public"
    setRoomSettingsJoinMode(nextMode)
    setRoomSettingsPassword("")
    setRoomSettingsOpen(true)
  }

  const saveRoomSettings = async () => {
    if (!roomId || !roomUserId) return
    setRoomSettingsSaving(true)
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          roomId,
          userId: roomUserId,
          joinMode: roomSettingsJoinMode,
          password: roomSettingsPassword,
        }),
      })
      if (res.status === 410) {
        exitRoom(t("toast.expiredTitle"), t("toast.expiredDesc"))
        return
      }
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; settings?: { adminUserId?: string; joinMode?: "public" | "password" } | null; error?: string }
        | null
      if (!res.ok || !data?.success || !data.settings?.adminUserId) {
        toast({
          title: t("toast.errorTitle"),
          description: data?.error ? String(data.error) : t("toast.roomSettingsSaveFailed"),
          variant: "destructive",
        })
        return
      }
      setRoomSettings({
        adminUserId: data.settings.adminUserId,
        joinMode: data.settings.joinMode === "password" ? "password" : "public",
      })
      setRoomSettingsOpen(false)
      toast({ title: t("toast.roomSettingsSavedTitle"), description: t("toast.roomSettingsSavedDesc") })
    } finally {
      setRoomSettingsSaving(false)
    }
  }

  const handleLeaveRoom = useCallback(async () => {
    try {
      leaveInitiatedRef.current = true
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
          originalLanguage: userLanguage.code,
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
        setLiveTranscript("")
        setLiveTranslation("")
      }
    },
    [exitRoom, roomId, roomUserId, t, toast, userLanguage.code, userLanguage.name, userName],
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
        onShowUsers={() => setIsUsersSheetOpen(true)}
      />

      <div className="flex-1 flex max-w-screen-2xl w-full mx-auto p-2 lg:p-4 gap-2 lg:gap-4 overflow-hidden min-h-0">
        <div className="hidden lg:flex w-64 flex-shrink-0 flex-col gap-4">
          <div className="min-h-0 flex-1">
            <UserList
              users={users}
              currentUserId={roomUserId}
              adminUserId={roomSettings?.adminUserId ?? null}
              canKick={isAdmin}
              onKick={handleKickUser}
            />
          </div>
          <AdSlot slotKey="room_sidebar" variant="sidebar" limit={2} fetchLimit={6} rotateMs={7000} />
        </div>

        <div className="flex-1 flex flex-col gap-2 lg:gap-3 min-w-0 min-h-0">
          <div className="lg:hidden">
            <AdSlot slotKey="room_inline" variant="inline" limit={1} />
          </div>

          <div className="flex-1 min-h-0 bg-card rounded-lg lg:rounded-xl border border-border overflow-hidden flex flex-col">
            <div className="shrink-0 px-2 lg:px-3 py-2 border-b border-border flex items-center gap-2">
              <div className="lg:hidden">
                <Sheet open={isUsersSheetOpen} onOpenChange={setIsUsersSheetOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                      <Users className="w-4 h-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[85%] sm:w-[380px] p-0">
                    <SheetHeader className="sr-only">
                      <SheetTitle>{t("users.title", { count: users.length })}</SheetTitle>
                      <SheetDescription>显示当前房间内的在线用户列表</SheetDescription>
                    </SheetHeader>
                    <div className="pt-10 h-full">
                      <UserList
                        users={users}
                        currentUserId={roomUserId}
                        adminUserId={roomSettings?.adminUserId ?? null}
                        canKick={isAdmin}
                        onKick={handleKickUser}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground hidden sm:block">{t("common.roomId")}</div>
                <div className="font-mono text-sm font-medium truncate flex items-center gap-2">
                  <span className="sm:hidden text-xs text-muted-foreground">ID:</span>
                  {roomId}
                </div>
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
              {isAdmin ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openRoomSettings}
                  className="h-9 w-9 shrink-0"
                  aria-label={t("roomSettings.title")}
                >
                  <Settings className="w-4 h-4" />
                </Button>
              ) : null}
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

            <div className="shrink-0 px-2 lg:px-3 py-2 border-b border-border hidden lg:block">
              <LanguageSelector
                variant="compact"
                language={userLanguage}
                onLanguageChange={setUserLanguage}
              />
            </div>

            <ChatArea
              variant="embedded"
              messages={messages}
              speechRate={settings.speechRate}
              speechVolume={settings.speechVolume}
              autoPlay={settings.autoPlayTranslations}
            />

            <div className="shrink-0 px-2 lg:px-3 py-2 border-t border-border bg-background/50">
              <div className="mb-2 lg:hidden">
                <LanguageSelector
                  variant="compact"
                  language={userLanguage}
                  onLanguageChange={setUserLanguage}
                />
              </div>
              {(isRecording || isProcessing) && (liveTranscript.trim() || !liveSpeechSupported) ? (
                <div className="mb-2 rounded-lg border bg-background/70 px-3 py-2">
                  {!liveSpeechSupported ? (
                    <div className="text-xs text-muted-foreground">{t("voice.liveUnsupported")}</div>
                  ) : null}
                  {liveTranscript.trim() ? (
                    <div className="space-y-2">
                      <div>
                        <div className="text-[11px] text-muted-foreground">{t("voice.liveCaptionTitle")}</div>
                        <div className="text-sm leading-relaxed">{liveTranscript}</div>
                      </div>
                      {liveTranslation.trim() ? (
                        <div>
                          <div className="text-[11px] text-muted-foreground">{t("voice.liveTranslationTitle")}</div>
                          <div className="text-sm leading-relaxed">{liveTranslation}</div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <VoiceControls
                variant="inline"
                isProcessing={isProcessing}
                onRecordingComplete={handleRecordingComplete}
                onRecordingChange={(next) => setIsRecording(next)}
              />
            </div>
          </div>
        </div>
      </div>

      <Dialog open={roomSettingsOpen} onOpenChange={setRoomSettingsOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("roomSettings.title")}</DialogTitle>
            <DialogDescription>{t("roomSettings.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("roomSettings.joinModeLabel")}</Label>
              <RadioGroup
                value={roomSettingsJoinMode}
                onValueChange={(v) => setRoomSettingsJoinMode(v as "public" | "password")}
                className="grid gap-2"
              >
                <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 cursor-pointer">
                  <RadioGroupItem value="public" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t("roomSettings.joinModePublic")}</div>
                    <div className="text-xs text-muted-foreground">{t("roomSettings.joinModePublicDesc")}</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 cursor-pointer">
                  <RadioGroupItem value="password" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t("roomSettings.joinModePassword")}</div>
                    <div className="text-xs text-muted-foreground">{t("roomSettings.joinModePasswordDesc")}</div>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {roomSettingsJoinMode === "password" ? (
              <div className="space-y-2">
                <Label htmlFor="roomSettingsPassword">{t("roomSettings.passwordLabel")}</Label>
                <Input
                  id="roomSettingsPassword"
                  type="password"
                  placeholder={t("roomSettings.passwordPlaceholder")}
                  value={roomSettingsPassword}
                  onChange={(e) => setRoomSettingsPassword(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={saveRoomSettings} disabled={roomSettingsSaving}>
              {roomSettingsSaving ? t("roomSettings.saving") : t("roomSettings.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
