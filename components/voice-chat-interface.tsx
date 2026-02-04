"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Header } from "@/components/header"
import { ChatArea } from "@/components/chat-area"
import { VoiceControls } from "@/components/voice-controls"
import { RoomJoin } from "@/components/room-join"
import { UserList, type User } from "@/components/user-list"
import { AdSlot } from "@/components/ad-slot"
import { detectLanguageFromText, transcribeAudio, translateText } from "@/lib/audio-utils"
import { useToast } from "@/hooks/use-toast"
import type { AppSettings } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
type CallSignalType = "call_invite" | "call_accept" | "call_reject" | "call_end" | "call_busy" | "webrtc_offer" | "webrtc_answer" | "webrtc_ice"
type CallSignalPayload = {
  type: CallSignalType
  callId: string
  fromUserId: string
  fromUserName: string
  toUserId: string
  sdp?: string
  sdpType?: RTCSdpType
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }
}

export function VoiceChatInterface() {
  const { profile, user, updateUserMetadata } = useAuth()
  const { t, locale } = useI18n()
  const [isInRoom, setIsInRoom] = useState(false)
  const [roomId, setRoomId] = useState("")
  const [anonUserId] = useState(() => {
    const fallback = `user-${Math.random().toString(36).substring(2, 11)}`
    if (typeof window === "undefined") return fallback
    const storageKey = "voicelink_anon_user_id"
    let storage: Storage | null = null
    try {
      storage = window.sessionStorage
    } catch {
      storage = null
    }
    const existing = storage?.getItem(storageKey)
    if (existing) return existing
    try {
      storage?.setItem(storageKey, fallback)
    } catch { }
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
  const [sourceLanguage, setSourceLanguage] = useState<Language>(SUPPORTED_LANGUAGES[0])
  const [targetLanguage, setTargetLanguage] = useState<Language>(SUPPORTED_LANGUAGES[0])
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
  const isTencentDeploy =
    typeof process !== "undefined" &&
    String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
      .trim()
      .toLowerCase() === "tencent"
  const [callStatus, setCallStatus] = useState<"idle" | "outgoing" | "incoming" | "active">("idle")
  const [callPeer, setCallPeer] = useState<{ id: string; name: string } | null>(null)
  const [callId, setCallId] = useState<string | null>(null)
  const [incomingCallOpen, setIncomingCallOpen] = useState(false)
  const [isCallStreaming, setIsCallStreaming] = useState(false)
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
  const lastSavedLanguagePrefsRef = useRef<{ userKey: string; source: string; target: string } | null>(null)
  const lastRoomLanguageUpdateRef = useRef<{ roomId: string; userId: string; source: string; target: string } | null>(null)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const liveTranslateAbortRef = useRef<AbortController | null>(null)
  const liveTranslateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callStatusRef = useRef(callStatus)
  const callPeerRef = useRef<{ id: string; name: string } | null>(null)
  const callIdRef = useRef<string | null>(null)
  const callRecorderRef = useRef<MediaRecorder | null>(null)
  const callStreamRef = useRef<MediaStream | null>(null)
  const callQueueRef = useRef<Blob[]>([])
  const callProcessingRef = useRef(false)
  const callActiveRef = useRef(false)
  const peerConnRef = useRef<RTCPeerConnection | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    callStatusRef.current = callStatus
    callPeerRef.current = callPeer
    callIdRef.current = callId
  }, [callStatus, callPeer, callId])

  const randomId = useCallback((): string => {
    if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
      return window.crypto.randomUUID()
    }
    return `call-${Math.random().toString(36).substring(2, 11)}`
  }, [])

  const resetCallState = useCallback(() => {
    setCallStatus("idle")
    setCallPeer(null)
    setCallId(null)
    setIncomingCallOpen(false)
    setIsCallStreaming(false)
    callActiveRef.current = false
    callQueueRef.current = []
    callProcessingRef.current = false
    if (callRecorderRef.current) {
      try {
        callRecorderRef.current.stop()
      } catch { }
      callRecorderRef.current = null
    }
    if (callStreamRef.current) {
      try {
        callStreamRef.current.getTracks().forEach((t) => t.stop())
      } catch { }
      callStreamRef.current = null
    }
    if (peerConnRef.current) {
      try {
        peerConnRef.current.onicecandidate = null
        peerConnRef.current.ontrack = null
        peerConnRef.current.close()
      } catch { }
      peerConnRef.current = null
    }
    if (remoteAudioRef.current) {
      try {
        remoteAudioRef.current.srcObject = null
      } catch { }
    }
  }, [])

  const ensureLocalMicStream = useCallback(async () => {
    if (callStreamRef.current) return callStreamRef.current
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    callStreamRef.current = stream
    return stream
  }, [])



  const sendSignal = useCallback(
    async (toUserId: string, payload: Record<string, unknown>) => {
      if (!roomId || !roomUserId) return
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "signal",
          roomId,
          userId: roomUserId,
          toUserId,
          payload,
        }),
      })
      if (!res.ok) throw new Error("发送信令失败")
    },
    [roomId, roomUserId],
  )

  const ensurePeerConnection = useCallback(
    async () => {
      if (peerConnRef.current) return peerConnRef.current
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      })
      pc.onicecandidate = (evt) => {
        const cand = evt.candidate
        const peer = callPeerRef.current
        const cid = callIdRef.current
        if (!peer || !cid || !cand) return
        void sendSignal(peer.id, {
          type: "webrtc_ice",
          callId: cid,
          candidate: {
            candidate: cand.candidate,
            sdpMid: cand.sdpMid,
            sdpMLineIndex: cand.sdpMLineIndex,
          },
        }).catch(() => { })
      }
      pc.ontrack = (evt) => {
        const [stream] = evt.streams
        if (!stream) return
        const el = remoteAudioRef.current
        if (!el) return
        try {
          el.srcObject = stream
          void el.play().catch(() => { })
        } catch { }
      }
      const local = await ensureLocalMicStream()
      for (const track of local.getTracks()) {
        pc.addTrack(track, local)
      }
      peerConnRef.current = pc
      setIsCallStreaming(true)
      return pc
    },
    [ensureLocalMicStream, sendSignal],
  )

  const startOutgoingCall = useCallback(
    async (target: { id: string; name: string }) => {
      if (!target?.id) return
      if (callStatusRef.current !== "idle") {
        toast({ title: t("call.busySelfTitle"), description: t("call.busySelfDesc") })
        return
      }
      const newId = randomId()
      setCallStatus("outgoing")
      setCallPeer({ id: target.id, name: target.name })
      setCallId(newId)
      try {
        await sendSignal(target.id, {
          type: "call_invite",
          callId: newId,
          fromUserId: roomUserId,
          fromUserName: userName || t("call.unknownUser"),
          toUserId: target.id,
        } as CallSignalPayload)
        toast({ title: t("call.outgoingTitle"), description: t("call.outgoingDesc", { name: target.name }) })
      } catch (e) {
        resetCallState()
        toast({ title: t("call.failedTitle"), description: t("call.failedDesc"), variant: "destructive" })
      }
    },
    [randomId, resetCallState, roomUserId, sendSignal, t, toast, userName],
  )

  const handleAcceptCall = useCallback(async () => {
    const peer = callPeerRef.current
    const id = callIdRef.current
    if (!peer || !id) return
    try {
      await sendSignal(peer.id, {
        type: "call_accept",
        callId: id,
        fromUserId: roomUserId,
        fromUserName: userName || t("call.unknownUser"),
        toUserId: peer.id,
      } as CallSignalPayload)
      setIncomingCallOpen(false)
      setCallStatus("active")
      callActiveRef.current = true
      void ensurePeerConnection().catch(() => { })
      toast({ title: t("call.acceptedTitle"), description: t("call.acceptedDesc", { name: peer.name }) })
    } catch {
      resetCallState()
      toast({ title: t("call.failedTitle"), description: t("call.acceptFailedDesc"), variant: "destructive" })
    }
  }, [ensurePeerConnection, resetCallState, roomUserId, sendSignal, t, toast, userName])

  const handleRejectCall = useCallback(async () => {
    const peer = callPeerRef.current
    const id = callIdRef.current
    if (!peer || !id) {
      resetCallState()
      return
    }
    try {
      await sendSignal(peer.id, {
        type: "call_reject",
        callId: id,
        fromUserId: roomUserId,
        fromUserName: userName || t("call.unknownUser"),
        toUserId: peer.id,
      } as CallSignalPayload)
      resetCallState()
      toast({ title: t("call.rejectedTitle"), description: t("call.rejectedDesc", { name: peer.name }) })
    } catch {
      resetCallState()
    }
  }, [resetCallState, roomUserId, sendSignal, t, toast, userName])

  const handleEndCall = useCallback(async () => {
    const peer = callPeerRef.current
    const id = callIdRef.current
    if (peer && id) {
      try {
        await sendSignal(peer.id, {
          type: "call_end",
          callId: id,
          fromUserId: roomUserId,
          fromUserName: userName || t("call.unknownUser"),
          toUserId: peer.id,
        } as CallSignalPayload)
      } catch { }
    }
    resetCallState()
    toast({ title: t("call.endedTitle"), description: t("call.endedDesc") })
  }, [resetCallState, roomUserId, sendSignal, t, toast, userName])

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
    recognition.lang = sourceLanguage.code === "auto" ? uiLocaleToLanguageCode() : sourceLanguage.code

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
  }, [isInRoom, isRecording, sourceLanguage.code, uiLocaleToLanguageCode])

  useEffect(() => {
    if (!isInRoom) return
    const sourceCode = sourceLanguage.code === "auto" ? detectLanguageFromText(liveTranscript) : sourceLanguage.code
    const targetCode = targetLanguage.code
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
  }, [isInRoom, liveTranscript, primaryOf, sourceLanguage.code, targetLanguage.code])

  const sourceLanguageOptions = useMemo<Language[]>(() => {
    const autoLabel = locale === "zh" ? "自动识别" : "Auto Detect"
    return [{ code: "auto", name: autoLabel, flag: "🌐" }, ...SUPPORTED_LANGUAGES]
  }, [locale])

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
    const rawTarget =
      (meta.targetLanguageCode as unknown) ??
      (meta.target_language_code as unknown) ??
      (meta.targetLanguage as unknown) ??
      (meta.target_language as unknown)

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
    const localTarget =
      readLocal(`voicelink_target_language:${userKey}`) ??
      (userKey !== "anon" ? readLocal("voicelink_target_language") : null) ??
      readLocal("voicelink_target_language:anon")

    const resolvedSource =
      typeof rawSource === "string" ? resolveLanguageCode(rawSource) : localSource ? resolveLanguageCode(localSource) : null
    const resolvedTarget =
      typeof rawTarget === "string" ? resolveLanguageCode(rawTarget) : localTarget ? resolveLanguageCode(localTarget) : null

    const nextSource = resolvedSource
      ? sourceLanguageOptions.find((l) => l.code === resolvedSource) ?? sourceLanguageOptions[0]
      : null
    const nextTarget = resolvedTarget ? SUPPORTED_LANGUAGES.find((l) => l.code === resolvedTarget) : null
    if (nextSource) setSourceLanguage(nextSource)
    if (nextTarget) setTargetLanguage(nextTarget)
    if (!nextSource && !nextTarget) {
      const fallbackCode = uiLocaleToLanguageCode()
      const fallbackLanguage = SUPPORTED_LANGUAGES.find((l) => l.code === fallbackCode) ?? SUPPORTED_LANGUAGES[0]
      setSourceLanguage(fallbackLanguage)
      setTargetLanguage(fallbackLanguage)
    }
  }, [resolveLanguageCode, sourceLanguageOptions, uiLocaleToLanguageCode, user?.id, user?.user_metadata])

  useEffect(() => {
    const userKey = user?.id ?? "anon"

    if (typeof window !== "undefined") {
      window.localStorage.setItem(`voicelink_source_language:${userKey}`, sourceLanguage.code)
      window.localStorage.setItem(`voicelink_target_language:${userKey}`, targetLanguage.code)
      if (userKey === "anon") {
        window.localStorage.setItem("voicelink_source_language", sourceLanguage.code)
        window.localStorage.setItem("voicelink_target_language", targetLanguage.code)
      }
    }

    if (!user) return
    const last = lastSavedLanguagePrefsRef.current
    if (last && last.userKey === userKey && last.source === sourceLanguage.code && last.target === targetLanguage.code) return
    lastSavedLanguagePrefsRef.current = { userKey, source: sourceLanguage.code, target: targetLanguage.code }
    void updateUserMetadata({ sourceLanguageCode: sourceLanguage.code, targetLanguageCode: targetLanguage.code }).catch((error) => {
      console.error("[v0] Save language prefs failed:", error)
    })
  }, [sourceLanguage.code, targetLanguage.code, updateUserMetadata, user])

  useEffect(() => {
    if (!isInRoom || !roomId || !roomUserId) return
    const source = sourceLanguage.code
    const target = targetLanguage.code
    const last = lastRoomLanguageUpdateRef.current
    if (last && last.roomId === roomId && last.userId === roomUserId && last.source === source && last.target === target) return
    lastRoomLanguageUpdateRef.current = { roomId, userId: roomUserId, source, target }

    const controller = new AbortController()
    fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_language",
        roomId,
        userId: roomUserId,
        sourceLanguage: source,
        targetLanguage: target,
      }),
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => { })

    return () => {
      controller.abort()
    }
  }, [isInRoom, roomId, roomUserId, sourceLanguage.code, targetLanguage.code])

  const ensureClientInstanceId = useCallback(() => {
    if (clientInstanceIdRef.current) return clientInstanceIdRef.current
    if (typeof window === "undefined") {
      const fallback = `ci-${Math.random().toString(36).substring(2, 11)}`
      clientInstanceIdRef.current = fallback
      return fallback
    }

    const storageKey = "voicelink_client_instance_id"
    let storage: Storage | null = null
    try {
      storage = window.sessionStorage
    } catch {
      storage = null
    }
    const existing = storage?.getItem(storageKey)
    if (existing) {
      clientInstanceIdRef.current = existing
      return existing
    }

    const created =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `ci-${Math.random().toString(36).substring(2, 11)}`
    try {
      storage?.setItem(storageKey, created)
    } catch { }
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
      resetCallState()
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

    const sendLeave = () => {
      if (leaveInitiatedRef.current) return
      leaveInitiatedRef.current = true
      const payload = JSON.stringify({ action: "leave", roomId, userId: roomUserId })
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([payload], { type: "application/json" })
        navigator.sendBeacon("/api/rooms", blob)
      } else {
        void fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        })
      }
    }

    window.addEventListener("pagehide", sendLeave)
    window.addEventListener("beforeunload", sendLeave)

    return () => {
      window.removeEventListener("pagehide", sendLeave)
      window.removeEventListener("beforeunload", sendLeave)
    }
  }, [isInRoom, roomId, roomUserId])

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
      let nextDelayMs = callActiveRef.current || callStatusRef.current !== "idle" ? 500 : 2000
      try {
        const controller = new AbortController()
        if (pollAbortRef.current) pollAbortRef.current.abort()
        pollAbortRef.current = controller

        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", roomId, userId: roomUserId }),
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
            signals?: Array<{ from?: string; payload?: unknown }>
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
        if (!leaveInitiatedRef.current && !room.users.some((u) => u.id === roomUserId)) {
          shouldSchedule = false
          exitRoom(t("toast.kickedTitle"), t("toast.kickedDesc"))
          return
        }

        const nextUsers = room.users.map((user) =>
          user.id === roomUserId
            ? { ...user, sourceLanguage: sourceLanguage.code, targetLanguage: targetLanguage.code }
            : user,
        )
        setUsers(nextUsers)

        const signals = Array.isArray(data.signals) ? data.signals : []
        if (signals.length > 0) {
          for (const evt of signals) {
            const fromId = typeof evt?.from === "string" ? evt.from : ""
            const payload = (evt?.payload ?? {}) as Partial<CallSignalPayload> & Record<string, unknown>
            const type = String(payload?.type ?? "")
            if (!fromId || !type) continue
            const fromUser = nextUsers.find((u) => u.id === fromId)
            const fromName = String(payload.fromUserName || fromUser?.name || t("call.unknownUser"))
            if (type === "call_invite") {
              const incomingId = String(payload.callId || "")
              if (callStatusRef.current !== "idle") {
                try {
                  await sendSignal(fromId, {
                    type: "call_busy",
                    callId: incomingId || randomId(),
                    fromUserId: roomUserId,
                    fromUserName: userName || t("call.unknownUser"),
                    toUserId: fromId,
                  } as CallSignalPayload)
                } catch { }
                continue
              }
              setCallPeer({ id: fromId, name: fromName })
              setCallId(incomingId || randomId())
              setCallStatus("incoming")
              setIncomingCallOpen(true)
              toast({ title: t("call.incomingTitle"), description: t("call.incomingDesc", { name: fromName }) })
              continue
            }
            if (type === "call_accept") {
              if (callStatusRef.current === "outgoing" && callPeerRef.current?.id === fromId) {
                const acceptId = String(payload.callId || "")
                if (!callIdRef.current || !acceptId || callIdRef.current === acceptId) {
                  setCallStatus("active")
                  callActiveRef.current = true
                  void (async () => {
                    try {
                      const pc = await ensurePeerConnection()
                      const offer = await pc.createOffer()
                      await pc.setLocalDescription(offer)
                      await sendSignal(fromId, {
                        type: "webrtc_offer",
                        callId: callIdRef.current,
                        sdp: offer.sdp,
                        sdpType: offer.type,
                      })
                    } catch { }
                  })()
                  toast({ title: t("call.acceptedTitle"), description: t("call.acceptedDesc", { name: fromName }) })
                }
              }
              continue
            }
            if (type === "webrtc_offer") {
              const incomingId = String(payload.callId || "")
              if (callStatusRef.current !== "active" || (incomingId && callIdRef.current && incomingId !== callIdRef.current)) {
                continue
              }
              const sdp = typeof payload.sdp === "string" ? payload.sdp : ""
              const sdpType = (typeof payload.sdpType === "string" ? payload.sdpType : "offer") as RTCSdpType
              if (!sdp) continue
              void (async () => {
                try {
                  const pc = await ensurePeerConnection()
                  await pc.setRemoteDescription({ type: sdpType, sdp })
                  const answer = await pc.createAnswer()
                  await pc.setLocalDescription(answer)
                  await sendSignal(fromId, {
                    type: "webrtc_answer",
                    callId: callIdRef.current,
                    sdp: answer.sdp,
                    sdpType: answer.type,
                  })
                } catch { }
              })()
              continue
            }
            if (type === "webrtc_answer") {
              const incomingId = String(payload.callId || "")
              if (callStatusRef.current !== "active" || (incomingId && callIdRef.current && incomingId !== callIdRef.current)) {
                continue
              }
              const sdp = typeof payload.sdp === "string" ? payload.sdp : ""
              const sdpType = (typeof payload.sdpType === "string" ? payload.sdpType : "answer") as RTCSdpType
              if (!sdp) continue
              const pc = peerConnRef.current
              if (!pc) continue
              try {
                await pc.setRemoteDescription({ type: sdpType, sdp })
              } catch { }
              continue
            }
            if (type === "webrtc_ice") {
              const incomingId = String(payload.callId || "")
              if (callStatusRef.current !== "active" || (incomingId && callIdRef.current && incomingId !== callIdRef.current)) {
                continue
              }
              const cand = payload.candidate as Record<string, unknown> | null
              if (!cand) continue
              const candidate = typeof cand.candidate === "string" ? cand.candidate : ""
              const sdpMid = typeof cand.sdpMid === "string" ? cand.sdpMid : null
              const sdpMLineIndex = typeof cand.sdpMLineIndex === "number" ? cand.sdpMLineIndex : null
              const pc = peerConnRef.current
              if (!pc || !candidate) continue
              try {
                await pc.addIceCandidate({ candidate, sdpMid: sdpMid ?? undefined, sdpMLineIndex: sdpMLineIndex ?? undefined })
              } catch { }
              continue
            }
            if (type === "call_reject" || type === "call_busy") {
              if (callStatusRef.current === "outgoing" && callPeerRef.current?.id === fromId) {
                resetCallState()
                toast({
                  title: type === "call_busy" ? t("call.busyTitle") : t("call.rejectedByPeerTitle"),
                  description: type === "call_busy" ? t("call.busyDesc", { name: fromName }) : t("call.rejectedByPeerDesc", { name: fromName }),
                })
              }
              continue
            }
            if (type === "call_end") {
              const endId = String(payload.callId || "")
              if (callStatusRef.current !== "idle" && (!endId || endId === callIdRef.current)) {
                resetCallState()
                toast({ title: t("call.endedByPeerTitle"), description: t("call.endedByPeerDesc") })
              }
              continue
            }
          }
        }

        const avatarById = new Map(room.users.map((u) => [u.id, u.avatar]))
        const newMessages = await Promise.all(
          room.messages.map(async (msg) => {
            const sourceLanguageCode = resolveLanguageCode(msg.originalLanguage)
            const targetLanguageCode = targetLanguage.code
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
  }, [exitRoom, isInRoom, resolveLanguageCode, roomId, roomUserId, t, sourceLanguage.code, targetLanguage.code, uiLocaleToLanguageCode])

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
          sourceLanguage: sourceLanguage.code,
          targetLanguage: targetLanguage.code,
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
        setUsers(
          data.room.users.map((entry) =>
            entry.id === participantId
              ? { ...entry, sourceLanguage: sourceLanguage.code, targetLanguage: targetLanguage.code }
              : entry,
          ),
        )
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
      const peer = callPeerRef.current
      const id = callIdRef.current
      if (peer && id) {
        try {
          await sendSignal(peer.id, {
            type: "call_end",
            callId: id,
            fromUserId: roomUserId,
            fromUserName: userName || t("call.unknownUser"),
            toUserId: peer.id,
          } as CallSignalPayload)
        } catch { }
      }
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
  }, [exitRoom, roomId, roomUserId, sendSignal, t, userName])

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

  const handleProfileSaved = useCallback(
    ({ displayName, avatarUrl }: { displayName: string; avatarUrl: string }) => {
      if (!roomUserId) return
      setUserName(displayName)
      setUsers((prev) =>
        prev.map((item) =>
          item.id === roomUserId
            ? { ...item, name: displayName, avatar: avatarUrl || item.avatar }
            : item,
        ),
      )
      setMessages((prev) =>
        prev.map((msg) => (msg.userId === roomUserId ? { ...msg, userName: displayName, userAvatar: avatarUrl || msg.userAvatar } : msg)),
      )
    },
    [roomUserId],
  )
  const handleRecordingComplete = useCallback(
    async (audioBlob: Blob) => {
      console.log("[v0] Recording complete, blob size:", audioBlob.size)
      setIsProcessing(true)

      try {
        const audioUrl = await new Promise<string | undefined>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            if (typeof reader.result === "string") {
              resolve(reader.result)
              return
            }
            resolve(undefined)
          }
          reader.onerror = () => resolve(undefined)
          reader.readAsDataURL(audioBlob)
        })

        const selectedLanguageCode = sourceLanguage.code
        const transcribedText = await transcribeAudio(audioBlob, selectedLanguageCode)
        console.log("[v0] Transcribed text:", transcribedText)
        const detectedLanguage =
          selectedLanguageCode === "auto" ? detectLanguageFromText(transcribedText) : selectedLanguageCode
        const detectedLanguageName =
          SUPPORTED_LANGUAGES.find((lang) => lang.code === detectedLanguage)?.name ?? detectedLanguage

        const message = {
          id: Date.now().toString(),
          userId: roomUserId,
          userName,
          originalText: transcribedText,
          originalLanguage: detectedLanguage,
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
          description: t("toast.sentDesc", { language: detectedLanguageName }),
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
    [exitRoom, roomId, roomUserId, sourceLanguage.code, t, toast, targetLanguage.code, userName],
  )

  if (!isInRoom) {
    return <RoomJoin onJoin={handleJoinRoom} />
  }

  return (
    <div className="flex flex-col h-screen">
      <audio ref={remoteAudioRef} className="hidden" />
      <Header
        onClearChat={handleClearChat}
        messageCount={messages.length}
        onSettingsChange={setSettings}
        roomId={isInRoom ? roomId : undefined}
        roomUserId={roomUserId}
        onProfileSaved={handleProfileSaved}
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
              roomId={roomId}
              onCall={(targetUserId) => {
                const target = users.find((u) => u.id === targetUserId)
                if (target) void startOutgoingCall({ id: target.id, name: target.name })
              }}
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
                        roomId={roomId}
                        onCall={(targetUserId) => {
                          const target = users.find((u) => u.id === targetUserId)
                          if (target) void startOutgoingCall({ id: target.id, name: target.name })
                        }}
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
              {callStatus !== "idle" && callPeer ? (
                <Button
                  variant={callStatus === "active" ? "destructive" : "secondary"}
                  size="sm"
                  onClick={handleEndCall}
                  className="h-9 shrink-0"
                >
                  {callStatus === "active" ? t("call.endedTitle") : t("common.cancel")}
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

            <ChatArea
              variant="embedded"
              messages={messages}
              speechRate={settings.speechRate}
              speechVolume={settings.speechVolume}
              autoPlay={settings.autoPlayTranslations}
            />

            <div className="shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border shadow-sm">
              {(isRecording || isProcessing) && (liveTranscript.trim() || !liveSpeechSupported) ? (
                <div className="absolute bottom-full left-0 right-0 p-4 bg-gradient-to-t from-background via-background/90 to-transparent pointer-events-none flex justify-center">
                  <div className="w-full max-w-2xl bg-card/95 border shadow-lg rounded-xl p-4 pointer-events-auto backdrop-blur animate-in fade-in slide-in-from-bottom-2">
                    {!liveSpeechSupported ? (
                      <div className="text-xs text-muted-foreground">{t("voice.liveUnsupported")}</div>
                    ) : null}
                    {liveTranscript.trim() ? (
                      <div className="space-y-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t("voice.liveCaptionTitle")}</div>
                          <div className="text-base font-medium leading-relaxed">{liveTranscript}</div>
                        </div>
                        {liveTranslation.trim() ? (
                          <div className="pt-2 border-t border-border/50">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t("voice.liveTranslationTitle")}</div>
                            <div className="text-base font-medium leading-relaxed text-primary">{liveTranslation}</div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="max-w-screen-xl mx-auto px-3 py-2 lg:px-6 lg:py-3">

                {/* Mobile: Compact Single Row Layout */}
                <div className="flex md:hidden w-full items-end justify-between gap-2 px-1 pb-1">
                  <div className="flex-1 min-w-0 max-w-[100px] flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider text-center">{t("language.source")}</Label>
                    <Select
                      value={sourceLanguage.code}
                      onValueChange={(code) => {
                        const next = sourceLanguageOptions.find((item) => item.code === code)
                        if (next) setSourceLanguage(next)
                      }}
                    >
                      <SelectTrigger className="w-full h-10 bg-muted/30 border-muted-foreground/20 px-2">
                        <SelectValue>
                          <span className="flex items-center justify-center gap-1.5">
                            <span className="text-xl leading-none">{sourceLanguage.flag}</span>
                            <span className="truncate text-xs font-medium">{sourceLanguage.name}</span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {sourceLanguageOptions.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            <span className="flex items-center gap-2">
                              <span>{lang.flag}</span>
                              <span>{lang.name}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="shrink-0 relative z-20 flex flex-col items-center">
                    <VoiceControls
                      variant="stacked"
                      showHint={true}
                      className="gap-1"
                      isProcessing={isProcessing}
                      onRecordingComplete={handleRecordingComplete}
                      onRecordingChange={(next) => setIsRecording(next)}
                    />
                    <div className="mt-1 text-[9px] text-muted-foreground/60 font-medium whitespace-nowrap">
                      {t("language.hint", { source: sourceLanguage.name, target: targetLanguage.name })}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 max-w-[100px] flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider text-center">{t("language.target")}</Label>
                    <Select
                      value={targetLanguage.code}
                      onValueChange={(code) => {
                        const next = SUPPORTED_LANGUAGES.find((item) => item.code === code)
                        if (next) setTargetLanguage(next)
                      }}
                    >
                      <SelectTrigger className="w-full h-10 bg-muted/30 border-muted-foreground/20 px-2">
                        <SelectValue>
                          <span className="flex items-center justify-center gap-1.5">
                            <span className="truncate text-xs font-medium">{targetLanguage.name}</span>
                            <span className="text-xl leading-none">{targetLanguage.flag}</span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            <span className="flex items-center gap-2">
                              <span>{lang.flag}</span>
                              <span>{lang.name}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Desktop: Centered Layout */}
                <div className="hidden md:flex items-center gap-6 w-full justify-center">
                  <div className="flex-1 flex flex-col gap-1 items-end">
                    <div className="w-full max-w-[200px]">
                      <div className="flex items-center justify-end gap-2 mb-1">
                        <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{t("language.source")}</Label>
                      </div>
                      <Select
                        value={sourceLanguage.code}
                        onValueChange={(code) => {
                          const next = sourceLanguageOptions.find((item) => item.code === code)
                          if (next) setSourceLanguage(next)
                        }}
                      >
                        <SelectTrigger className="w-full h-11 bg-muted/30 border-muted-foreground/20 text-sm">
                          <SelectValue>
                            <span className="flex items-center gap-2 truncate justify-end">
                              <span className="truncate">{sourceLanguage.name}</span>
                              <span className="text-xl leading-none">{sourceLanguage.flag}</span>
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {sourceLanguageOptions.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              <span className="flex items-center gap-2">
                                <span>{lang.flag}</span>
                                <span>{lang.name}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="shrink-0 relative z-20 flex flex-col items-center">
                    <VoiceControls
                      variant="stacked"
                      showHint={true}
                      className="gap-1"
                      isProcessing={isProcessing}
                      onRecordingComplete={handleRecordingComplete}
                      onRecordingChange={(next) => setIsRecording(next)}
                    />
                    <div className="mt-1 w-max text-[10px] text-muted-foreground/60 font-medium whitespace-nowrap">
                      {t("language.hint", { source: sourceLanguage.name, target: targetLanguage.name })}
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col gap-1 items-start">
                    <div className="w-full max-w-[200px]">
                      <div className="flex items-center justify-start gap-2 mb-1">
                        <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{t("language.target")}</Label>
                      </div>
                      <Select
                        value={targetLanguage.code}
                        onValueChange={(code) => {
                          const next = SUPPORTED_LANGUAGES.find((item) => item.code === code)
                          if (next) setTargetLanguage(next)
                        }}
                      >
                        <SelectTrigger className="w-full h-11 bg-muted/30 border-muted-foreground/20 text-sm">
                          <SelectValue>
                            <span className="flex items-center gap-2 truncate">
                              <span className="text-xl leading-none">{targetLanguage.flag}</span>
                              <span>{targetLanguage.name}</span>
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPORTED_LANGUAGES.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              <span className="flex items-center gap-2">
                                <span>{lang.flag}</span>
                                <span>{lang.name}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
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

      <Dialog
        open={incomingCallOpen}
        onOpenChange={(open) => {
          setIncomingCallOpen(open)
          if (!open && callStatusRef.current === "incoming") {
            void handleRejectCall()
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("call.incomingTitle")}</DialogTitle>
            <DialogDescription>
              {callPeer ? t("call.incomingDesc", { name: callPeer.name }) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="secondary" onClick={handleRejectCall}>
              {t("call.rejectedTitle")}
            </Button>
            <Button onClick={handleAcceptCall}>{t("call.acceptedTitle")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
