"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Header } from "@/components/header"
import { ChatArea } from "@/components/chat-area"
import { VoiceControls } from "@/components/voice-controls"
import { RoomJoin } from "@/components/room-join"
import { UserList, type User } from "@/components/user-list"
import { AdSlot } from "@/components/ad-slot"
import { detectLanguageFromText, encodeFloat32ToWav, resampleTo16k, transcribeAudio, translateText } from "@/lib/audio-utils"
import { useToast } from "@/hooks/use-toast"
import type { AppSettings } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LogOut, Copy, Check, Settings, Users, Mic, MicOff, PhoneOff, Phone } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useI18n } from "@/components/i18n-provider"
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import TRTC from "trtc-sdk-v5"
import { RealtimeTranscriber } from "trtc-sdk-v5/plugins/realtime-transcriber"
import { TencentASR } from "@/lib/asr-client"

declare global {
  interface Window {
    __medianPushNativeAudio?: (base64: string, sampleRate: number, channels: number) => void
    mornspeakerOnSystemAudioStatus?: (status: string) => void
    mornspeakerStartSystemAudio?: () => void
    mornspeakerStopSystemAudio?: () => void
    AndroidTencentAsr?: {
      startAsr: (configJson: string) => void
      stopAsr: () => void
      cancelAsr: () => void
    }
    mornspeakerOnAsrResult?: (text: string, isFinal: boolean) => void
    mornspeakerOnAsrError?: (error: string) => void
    mornspeakerOnAsrState?: (state: string) => void
  }
}

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
type CallSignalType = "call_invite" | "call_accept" | "call_reject" | "call_end" | "call_busy" | "webrtc_offer" | "webrtc_answer" | "webrtc_ice" | "call_caption"
type CallSignalPayload = {
  type: CallSignalType
  callId: string
  fromUserId: string
  fromUserName: string
  toUserId: string
  sdp?: string
  sdpType?: RTCSdpType
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }
  transcript?: string
  confirmedTranscript?: string
  translation?: string
  sourceLanguage?: string
  targetLanguage?: string
  timestamp?: number
}

type VoiceChatInterfaceProps = {
  initialRoomId?: string | null
  autoJoin?: boolean
}

export function VoiceChatInterface({ initialRoomId, autoJoin = false }: VoiceChatInterfaceProps) {
  const params = useParams()
  const searchParams = useSearchParams()
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
  const urlRoomId = useMemo(() => {
    const paramRoomId = typeof params?.roomId === "string" ? params.roomId.trim() : ""
    const searchRoomId = searchParams?.get("roomId")?.trim() ?? ""
    const propRoomId = typeof initialRoomId === "string" ? initialRoomId.trim() : ""
    return paramRoomId || searchRoomId || propRoomId || ""
  }, [initialRoomId, params, searchParams])
  const [liveTranslation, setLiveTranslation] = useState("")
  const [liveTranscriptLines, setLiveTranscriptLines] = useState<string[]>([])
  const [liveTranslationLines, setLiveTranslationLines] = useState<string[]>([])
  const [remoteLiveTranscript, setRemoteLiveTranscript] = useState("")
  const [remoteConfirmedTranscript, setRemoteConfirmedTranscript] = useState("")
  const [remoteLiveTranslation, setRemoteLiveTranslation] = useState("")
  const [remoteLiveSourceLanguage, setRemoteLiveSourceLanguage] = useState("")
  const [remoteLiveUserName, setRemoteLiveUserName] = useState("")
  const [liveSpeechSupported, setLiveSpeechSupported] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [settings, setSettings] = useState<AppSettings>({
    darkMode: false,
    autoPlayTranslations: true,
    onlyHearTranslatedVoice: true,
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
  const isMobile = useMemo(() => {
    if (typeof navigator === "undefined") return false
    return /iphone|ipad|ipod|android/i.test(navigator.userAgent)
  }, [])
  const [callStatus, setCallStatus] = useState<"idle" | "outgoing" | "incoming" | "active">("idle")
  const [callPeer, setCallPeer] = useState<{ id: string; name: string } | null>(null)
  const [callId, setCallId] = useState<string | null>(null)
  const [incomingCallOpen, setIncomingCallOpen] = useState(false)
  const [isCallStreaming, setIsCallStreaming] = useState(false)
  const [callDurationSec, setCallDurationSec] = useState(0)
  const [isCallMuted, setIsCallMuted] = useState(false)
  const [callLiveEnabled, setCallLiveEnabled] = useState(true)
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
  const remoteTranslateAbortRef = useRef<AbortController | null>(null)
  const remoteTranslateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveCaptionSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveAutoBreakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveCommittedTranscriptRef = useRef("")
  const liveCommittedTranslationRef = useRef("")
  const fallbackRecorderRef = useRef<MediaRecorder | null>(null)
  const fallbackStreamRef = useRef<MediaStream | null>(null)
  const fallbackStreamOwnedRef = useRef(false)
  const fallbackQueueRef = useRef<Blob[]>([])
  const fallbackProcessingRef = useRef(false)
  const fallbackLastTextRef = useRef("")
  const fallbackAudioContextRef = useRef<AudioContext | null>(null)
  const fallbackProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const fallbackBufferedChunksRef = useRef<Float32Array[]>([])
  const fallbackBufferedSamplesRef = useRef(0)
  const callStatusRef = useRef(callStatus)
  const callPeerRef = useRef<{ id: string; name: string } | null>(null)
  const callIdRef = useRef<string | null>(null)
  const callRecorderRef = useRef<MediaRecorder | null>(null)
  const callStreamRef = useRef<MediaStream | null>(null)
  const callQueueRef = useRef<Blob[]>([])
  const callProcessingRef = useRef(false)
  const callActiveRef = useRef(false)
  const trtcRef = useRef<any>(null)
  const tencentAsrRef = useRef<any>(null)
  const aiTranscriberListenerRef = useRef<any>(null)
  const aiTranscriberStateListenerRef = useRef<any>(null)
  const aiTranscriberCustomListenerRef = useRef<any>(null)
  const aiTranscriberRobotIdRef = useRef<string | null>(null)
  const aiTranscriberTranslationRef = useRef<string>("")
  const aiTranscriberSourceLangRef = useRef<string>("")
  const aiTranscriberTargetLangRef = useRef<string>("")
  const trtcUserIdRef = useRef<string | null>(null)
  const trtcRoomIdRef = useRef<number | null>(null)
  const [trtcTranscriberActive, setTrtcTranscriberActive] = useState(false)
  const [trtcTranscriberTranslationActive, setTrtcTranscriberTranslationActive] = useState(false)
  const trtcTranscriberActiveRef = useRef(false)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const liveListenRef = useRef(false)
  const { speak, speakWithOptions, unlock: unlockTts, isSupported: ttsSupported, isUnlocked: isTtsUnlocked, isSpeaking: ttsSpeaking, getVoices, getLastVoice } = useTextToSpeech({
    rate: settings.speechRate,
    volume: settings.speechVolume,
  })
  const remoteCommittedTranslationRef = useRef("")
  const remoteCommittedTranscriptRef = useRef("")
  const remoteSpokenTranslationRef = useRef("")
  const remoteLastSpokenTextRef = useRef("")
  const trtcCustomCaptionActiveRef = useRef(false)
  const remoteTranslateLatestRef = useRef("")
  const remoteTranslateSourceRef = useRef("")
  const remoteTranslateTargetRef = useRef("")
  const ttsUnlockedRef = useRef(false)
  const ttsUnlockingRef = useRef(false)
  const ttsSpeakingRef = useRef(false)
  const ttsLastStartRef = useRef(0)
  const ttsUnsupportedNotifiedRef = useRef(false)
  const pendingTtsRef = useRef<{ text: string; lang: string } | null>(null)
  const ttsDeferredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ttsDeferredTextRef = useRef("")
  const ttsDeferredFullRef = useRef("")

  useEffect(() => {
    callStatusRef.current = callStatus
    callPeerRef.current = callPeer
    callIdRef.current = callId
  }, [callStatus, callPeer, callId])

  useEffect(() => {
    ttsUnlockedRef.current = isTtsUnlocked
  }, [isTtsUnlocked])

  useEffect(() => {
    ttsSpeakingRef.current = ttsSpeaking
    if (ttsSpeaking) {
      ttsLastStartRef.current = Date.now()
    }
  }, [ttsSpeaking])

  // Native ASR Callbacks
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.mornspeakerOnAsrResult = (text: string, isFinal: boolean) => {
        console.log("Native ASR Result:", text, isFinal)
        const isHallucination = (t: string) => {
          const str = t.toLowerCase().replace(/[.,!?。，！？]/g, '')
          if (str === "你好") return true
          if (str === "你好你好") return true
          if (str === "不客气") return true
          if (str === "谢谢") return true
          if (str === "bye") return true
          if (str === "you're welcome") return true
          if (str === "字幕" || str.includes("subtitles by")) return true
          if (str === "amaraorg") return true
          return false
        }

        if (text && !isHallucination(text)) {
          // Native SDK returns full text for the current sentence/segment?
          // Based on TencentAsrManager.java:
          // onSliceSuccess (interim) -> isFinal=false
          // onSegmentSuccess (final) -> isFinal=true
          // And it passes result.getText() which is usually the text of the current sentence.

          // Logic similar to WebSocket handling
          // But we don't have voice_id here easily unless we change Java.
          // Assuming Java sends the accumulated text for the current sentence.

          if (isFinal) {
            const isCJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text)
            sessionTranscriptRef.current += text + (isCJK ? "" : " ")
            setConfirmedTranscript(sessionTranscriptRef.current)
            setLiveTranscript(sessionTranscriptRef.current)
            setIsInterim(false)
          } else {
            setLiveTranscript(sessionTranscriptRef.current + text)
            setIsInterim(true)
          }
        }
      }

      window.mornspeakerOnAsrError = (error: string) => {
        console.error("Native ASR Error:", error)
        toast({
          title: "语音识别错误",
          description: error,
          variant: "destructive",
        })
        setAsrMode("off")
      }

      window.mornspeakerOnAsrState = (state: string) => {
        console.log("Native ASR State:", state)
        if (state === "recording") {
          setAsrMode("websocket") // reuse websocket mode indicator for active state
        } else if (state === "stopped") {
          setAsrMode("off")
        }
      }
    }
  }, [toast])

  const randomId = useCallback((): string => {
    if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
      return window.crypto.randomUUID()
    }
    return `call-${Math.random().toString(36).substring(2, 11)}`
  }, [])

  const fallbackTrtcUserId = useCallback((value: string) => {
    const input = typeof value === "string" ? value : String(value)
    let hash1 = 2166136261
    let hash2 = 2166136261 ^ 0xffffffff
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i)
      hash1 = Math.imul(hash1 ^ code, 16777619) >>> 0
      hash2 = Math.imul(hash2 ^ (code + 2654435761), 16777619) >>> 0
    }
    const part1 = hash1.toString(16).padStart(8, "0")
    const part2 = hash2.toString(16).padStart(8, "0")
    return (part1 + part2 + part1 + part2).slice(0, 32)
  }, [])

  const getTrtcUserId = useCallback(async (userId: string) => {
    const subtle = globalThis.crypto?.subtle
    if (subtle && typeof TextEncoder !== "undefined") {
      try {
        const msgUint8 = new TextEncoder().encode(userId)
        const hashBuffer = await subtle.digest("SHA-256", msgUint8)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
        return hashHex.substring(0, 32)
      } catch {
        return fallbackTrtcUserId(userId)
      }
    }
    return fallbackTrtcUserId(userId)
  }, [fallbackTrtcUserId])

  const stopFallbackLive = useCallback(() => {
    // Stop Android Native ASR if running
    if (typeof window !== "undefined" && window.AndroidTencentAsr && isMobile) {
      try {
        window.AndroidTencentAsr.stopAsr()
      } catch (e) {
        console.error("Error stopping Android ASR", e)
      }
    }

    if (fallbackRecorderRef.current) {
      try {
        if (fallbackRecorderRef.current.state !== "inactive") {
          fallbackRecorderRef.current.stop()
        }
      } catch { }
      fallbackRecorderRef.current = null
    }
    if (fallbackProcessorRef.current) {
      try {
        fallbackProcessorRef.current.disconnect()
      } catch { }
      fallbackProcessorRef.current = null
    }
    if (fallbackAudioContextRef.current) {
      try {
        void fallbackAudioContextRef.current.close()
      } catch { }
      fallbackAudioContextRef.current = null
    }
    if (fallbackStreamRef.current && fallbackStreamOwnedRef.current) {
      try {
        fallbackStreamRef.current.getTracks().forEach((t) => t.stop())
      } catch { }
    }
    fallbackStreamRef.current = null
    fallbackStreamOwnedRef.current = false
    fallbackQueueRef.current = []
    fallbackProcessingRef.current = false
    fallbackLastTextRef.current = ""
    fallbackBufferedChunksRef.current = []
    fallbackBufferedSamplesRef.current = 0
  }, [])

  const stopTrtcRealtimeTranscriber = useCallback(async () => {
    const trtc = trtcRef.current
    const robotId = aiTranscriberRobotIdRef.current
    if (trtc && robotId && trtcTranscriberActiveRef.current) {
      try {
        await trtc.stopPlugin("RealtimeTranscriber", { transcriberRobotId: robotId })
      } catch { }
    }
    aiTranscriberRobotIdRef.current = null
    aiTranscriberTranslationRef.current = ""
    aiTranscriberSourceLangRef.current = ""
    aiTranscriberTargetLangRef.current = ""
    trtcTranscriberActiveRef.current = false
    setTrtcTranscriberActive(false)
    setTrtcTranscriberTranslationActive(false)
    trtcCustomCaptionActiveRef.current = false
  }, [])


  const cleanupTrtc = useCallback(async () => {
    const trtc = trtcRef.current
    if (!trtc) return
    if (aiTranscriberListenerRef.current) {
      trtc.off(TRTC.EVENT.REALTIME_TRANSCRIBER_MESSAGE, aiTranscriberListenerRef.current)
      aiTranscriberListenerRef.current = null
    }
    if (aiTranscriberStateListenerRef.current) {
      trtc.off(TRTC.EVENT.REALTIME_TRANSCRIBER_STATE_CHANGED, aiTranscriberStateListenerRef.current)
      aiTranscriberStateListenerRef.current = null
    }
    if (aiTranscriberCustomListenerRef.current) {
      trtc.off(TRTC.EVENT.CUSTOM_MESSAGE, aiTranscriberCustomListenerRef.current)
      aiTranscriberCustomListenerRef.current = null
    }
    await stopTrtcRealtimeTranscriber()
    try {
      trtc.stopLocalAudio()
    } catch { }
    try {
      await trtc.exitRoom()
    } catch { }
    try {
      trtc.destroy()
    } catch { }
    trtcRef.current = null
    trtcUserIdRef.current = null
    trtcRoomIdRef.current = null
  }, [stopTrtcRealtimeTranscriber])

  const startTrtcRealtimeTranscriber = useCallback(async (options: {
    sourceLanguage: string
    targetLanguage?: string
    roomId: number
    userId: string
  }) => {
    const trtc = trtcRef.current
    if (!trtc) return false
    const normalize = (value: string) => {
      const raw = typeof value === "string" ? value.trim() : ""
      const normalized = raw.replaceAll("_", "-")
      return (normalized.split("-")[0] ?? normalized).toLowerCase()
    }
    const sourceLanguage = normalize(options.sourceLanguage)
    const targetLanguage = options.targetLanguage ? normalize(options.targetLanguage) : ""
    const robotId = `transcriber_${options.roomId}_robot_${options.userId}`
    aiTranscriberRobotIdRef.current = robotId
    aiTranscriberSourceLangRef.current = sourceLanguage
    aiTranscriberTargetLangRef.current = targetLanguage
    try {
      await trtc.startPlugin("RealtimeTranscriber", {
        sourceLanguage,
        translationLanguages: targetLanguage ? [targetLanguage] : undefined,
        userIdsToTranscribe: options.userId,
        transcriberRobotId: robotId,
      })
      trtcTranscriberActiveRef.current = true
      setTrtcTranscriberActive(true)
      setTrtcTranscriberTranslationActive(Boolean(targetLanguage))
      if (tencentAsrRef.current) {
        tencentAsrRef.current.stop()
        tencentAsrRef.current = null
      }
      stopFallbackLive()
      return true
    } catch {
      trtcTranscriberActiveRef.current = false
      setTrtcTranscriberActive(false)
      setTrtcTranscriberTranslationActive(false)
      return false
    }
  }, [stopFallbackLive])

  const resetCallState = useCallback(() => {
    setCallStatus("idle")
    callStatusRef.current = "idle"
    setCallPeer(null)
    callPeerRef.current = null
    setCallId(null)
    callIdRef.current = null
    setIncomingCallOpen(false)
    setIsCallStreaming(false)
    setCallDurationSec(0)
    setIsCallMuted(false)
    setCallLiveEnabled(true)
    setLiveTranscript("")
    setLiveTranslation("")
    setLiveTranscriptLines([])
    setLiveTranslationLines([])
    setConfirmedTranscript("")
    liveCommittedTranscriptRef.current = ""
    liveCommittedTranslationRef.current = ""
    sessionTranscriptRef.current = ""
    lastVoiceIdRef.current = ""
    lastReceivedTextRef.current = ""
    if (liveAutoBreakTimerRef.current) {
      clearTimeout(liveAutoBreakTimerRef.current)
      liveAutoBreakTimerRef.current = null
    }
    setRemoteLiveTranscript("")
    setRemoteConfirmedTranscript("")
    setRemoteLiveTranslation("")
    setRemoteLiveSourceLanguage("")
    setRemoteLiveUserName("")
    remoteCommittedTranslationRef.current = ""
    remoteCommittedTranscriptRef.current = ""
    trtcCustomCaptionActiveRef.current = false
    stopFallbackLive()
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
    void cleanupTrtc()
    if (tencentAsrRef.current) {
      tencentAsrRef.current.stop()
      tencentAsrRef.current = null
    }
    if (remoteAudioRef.current) {
      try {
        remoteAudioRef.current.srcObject = null
      } catch { }
    }
  }, [cleanupTrtc, stopFallbackLive])

  const callPeerUser = useMemo(() => users.find((item) => item.id === callPeer?.id), [users, callPeer?.id])

  const globalVoiceActivityRef = useRef<number | undefined>(undefined)
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const vadAudioContextRef = useRef<AudioContext | null>(null)
  const vadAnalyzerRef = useRef<AnalyserNode | null>(null)
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const shouldLiveListen = isRecording || (callStatus === "active" && callLiveEnabled && !isCallMuted)

  useEffect(() => {
    liveListenRef.current = shouldLiveListen
  }, [shouldLiveListen])

  // Initialize VAD when local mic stream is active
  useEffect(() => {
    if (callStatus !== "active" && !shouldLiveListen) {
      // Cleanup VAD if not needed
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current)
        vadIntervalRef.current = null
      }
      if (vadAudioContextRef.current) {
        vadAudioContextRef.current.close().catch(() => { })
        vadAudioContextRef.current = null
      }
      globalVoiceActivityRef.current = undefined
      return
    }

    const initVad = async () => {
      try {
        const stream = callStreamRef.current || fallbackStreamRef.current
        if (!stream) return

        if (!vadAudioContextRef.current) {
          const AudioContext = window.AudioContext || (window as any).webkitAudioContext
          if (!AudioContext) return
          vadAudioContextRef.current = new AudioContext()
        }

        const ctx = vadAudioContextRef.current
        if (ctx.state === "suspended") await ctx.resume()

        if (!vadAnalyzerRef.current) {
          vadAnalyzerRef.current = ctx.createAnalyser()
          vadAnalyzerRef.current.fftSize = 512
        }

        // Don't recreate source if already connected to same stream?
        // Actually streams change, so safer to recreate source
        if (vadSourceRef.current) {
          vadSourceRef.current.disconnect()
        }

        // Create source from the stream (clone track to avoid interfering?)
        // MediaStreamSourceNode can be created from stream
        // Note: Chrome allows multiple sources from same stream
        const source = ctx.createMediaStreamSource(stream)
        source.connect(vadAnalyzerRef.current)
        vadSourceRef.current = source

        // Start polling volume
        if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)

        const dataArray = new Uint8Array(vadAnalyzerRef.current.frequencyBinCount)

        vadIntervalRef.current = setInterval(() => {
          if (!vadAnalyzerRef.current) return
          vadAnalyzerRef.current.getByteTimeDomainData(dataArray)

          let sumSq = 0
          for (let i = 0; i < dataArray.length; i++) {
            const norm = (dataArray[i] - 128) / 128
            sumSq += norm * norm
          }
          const rms = Math.sqrt(sumSq / dataArray.length)

          // Threshold: 0.01 is roughly silence. 0.02 is quiet noise.
          // Adjusted for mobile: 0.01 for mobile, 0.04 for desktop
          const vadThreshold = isMobile ? 0.01 : 0.04
          if (rms > vadThreshold) {
            globalVoiceActivityRef.current = Date.now()
          }
        }, 100)

      } catch (err) {
        console.error("[v0] VAD init failed:", err)
      }
    }

    // Delay init to ensure stream is ready
    const timer = setTimeout(() => void initVad(), 1000)
    return () => clearTimeout(timer)
  }, [callStatus, shouldLiveListen, callStreamRef.current, fallbackStreamRef.current])

  const formatCallDuration = useCallback((value: number) => {
    const total = Math.max(0, Math.floor(value))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  }, [])

  const sourceLanguageRef = useRef<string>(sourceLanguage.code)
  useEffect(() => {
    sourceLanguageRef.current = sourceLanguage.code
  }, [sourceLanguage.code])

  const [asrMode, setAsrMode] = useState<"off" | "http" | "websocket">("off")
  const [isInterim, setIsInterim] = useState(false)
  const [confirmedTranscript, setConfirmedTranscript] = useState("")

  // Tencent Cloud Real-time ASR WebSocket Client (Managed by TencentASR class)
  const sessionTranscriptRef = useRef<string>("")
  const lastVoiceIdRef = useRef<string>("")
  const lastReceivedTextRef = useRef<string>("")
  const nativeAudioActiveRef = useRef(false)

  // Handle Android Native Audio Bridge
  useEffect(() => {
    if (typeof window === "undefined") return

    // Callback for native audio data (base64 PCM 16k 16bit mono)
    window.__medianPushNativeAudio = (base64: string, sampleRate: number, channels: number) => {
      try {
        const binaryString = window.atob(base64)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        // Convert Uint8Array to Int16Array (PCM 16bit)
        const pcmData = new Int16Array(bytes.buffer)

        // Simple VAD (Voice Activity Detection) for Android Native Audio
        let sumSq = 0
        for (let i = 0; i < pcmData.length; i++) {
          const sample = pcmData[i] / 32768.0
          sumSq += sample * sample
        }
        const rms = Math.sqrt(sumSq / pcmData.length)
        if (rms < 0.01) return

        // Push to ASR logic
        if (tencentAsrRef.current) {
          tencentAsrRef.current.feedAudio(pcmData)
        }
      } catch (e) {
        console.error("Native audio decode error", e)
      }
    }

    // ... (status callback)
    window.mornspeakerOnSystemAudioStatus = (status: string) => {
      // ...
    }

    return () => { }
  }, [])

  const connectNativeAsr = useCallback(async () => {
    if (tencentAsrRef.current) return

    tencentAsrRef.current = new TencentASR({
      // No audio track provided -> Manual feed mode
      OnRecognitionResultChange: (res: any) => {
        if (res?.result?.voice_text_str) {
          setLiveTranscript(sessionTranscriptRef.current + res.result.voice_text_str)
          setIsInterim(true)
        }
      },
      OnSentenceEnd: (res: any) => {
        if (res?.result?.voice_text_str) {
          const text = res.result.voice_text_str
          sessionTranscriptRef.current += text
          setConfirmedTranscript(sessionTranscriptRef.current)
          setLiveTranscript(sessionTranscriptRef.current)
          setIsInterim(false)
        }
      },
      OnError: (err: any) => console.error("Native ASR Error", err)
    })
    await tencentAsrRef.current.start()
  }, [])

  const startFallbackLive = useCallback(async () => {
    // If we are in a call, we rely on TRTC ASR, so don't start fallback.
    if (callStatusRef.current === "active") return

    if (fallbackRecorderRef.current || fallbackProcessorRef.current || tencentAsrRef.current) return
    try {
      // Android Native ASR Support
      if (typeof window !== "undefined" && window.AndroidTencentAsr && isMobile) {
        // Initialize JS WS client to receive audio from native
        await connectNativeAsr()

        // Trigger native side to start capturing and pushing audio
        // We pass empty config or minimal config as the native side handles capture
        // The native side expects a JSON string config
        const config = JSON.stringify({
          // We can pass params if needed, or empty
          // native logic seems to just need a start signal
        })
        window.AndroidTencentAsr.startAsr(config)

        return
      }

      // Web Fallback (getUserMedia + TencentASR class)
      // If TRTC is active, skip fallback as TRTC manages audio/ASR
      if (trtcRef.current) return

      let stream: MediaStream | null = null
      let owned = false

      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          sampleSize: 16,
        }
      }
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      owned = true

      fallbackStreamRef.current = stream
      fallbackStreamOwnedRef.current = owned

      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        if (tencentAsrRef.current) {
          tencentAsrRef.current.stop()
        }
        tencentAsrRef.current = new TencentASR({
          audioTrack,
          OnRecognitionResultChange: (res: any) => {
            if (res?.result?.voice_text_str) {
              setLiveTranscript(sessionTranscriptRef.current + res.result.voice_text_str)
              setIsInterim(true)
            }
          },
          OnSentenceEnd: (res: any) => {
            if (res?.result?.voice_text_str) {
              const text = res.result.voice_text_str
              sessionTranscriptRef.current += text
              setConfirmedTranscript(sessionTranscriptRef.current)
              setLiveTranscript(sessionTranscriptRef.current)
              setIsInterim(false)
            }
          },
          OnError: (err: any) => {
            console.error("ASR Error", err)
            // If WS fails, maybe try HTTP fallback?
            // For now just log.
          }
        })
        tencentAsrRef.current.start()
        setAsrMode("websocket")
      }

      setLiveSpeechSupported(true)
    } catch (e) {
      console.error("Failed to start fallback ASR", e)
      setLiveSpeechSupported(false)
      toast({
        title: t("toast.errorTitle"),
        description: t("voice.micPermissionAlert"),
        variant: "destructive",
      })
      stopFallbackLive()
    }
  }, [isMobile, t, toast, stopFallbackLive])



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

  const fetchUserSig = async (userId: string) => {
    const res = await fetch(`/api/trtc/user-sig?userId=${encodeURIComponent(userId)}`)
    if (!res.ok) throw new Error("Failed to fetch UserSig")
    const data = await res.json()
    if (!data?.userSig || !data?.sdkAppId) {
      throw new Error("Invalid TRTC credentials")
    }
    return data
  }

  const uiLocaleToLanguageCode = useCallback((): string => {
    if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
      const lang = navigator.language.trim()
      const lower = lang.toLowerCase()
      if (lower.startsWith("zh")) return "zh-CN"
      if (lower.startsWith("ja")) return "ja-JP"
      if (lower.startsWith("ko")) return "ko-KR"
      return lang
    }
    if (locale === "zh") return "zh-CN"
    if (locale === "ja") return "ja-JP"
    return "en-US"
  }, [locale])

  const primaryOf = useCallback((code: string) => {
    const raw = typeof code === "string" ? code.trim() : ""
    const normalized = raw.replaceAll("_", "-")
    return (normalized.split("-")[0] ?? normalized).toLowerCase()
  }, [])

  const appendText = useCallback((base: string, addition: string) => {
    const left = typeof base === "string" ? base.trim() : ""
    const right = typeof addition === "string" ? addition.trim() : ""
    if (!right) return left
    return left ? `${left} ${right}`.trim() : right
  }, [])

  const bindTrtcRealtimeTranscriberEvents = useCallback((trtc: any) => {
    if (aiTranscriberListenerRef.current) {
      trtc.off(TRTC.EVENT.REALTIME_TRANSCRIBER_MESSAGE, aiTranscriberListenerRef.current)
      aiTranscriberListenerRef.current = null
    }
    if (aiTranscriberStateListenerRef.current) {
      trtc.off(TRTC.EVENT.REALTIME_TRANSCRIBER_STATE_CHANGED, aiTranscriberStateListenerRef.current)
      aiTranscriberStateListenerRef.current = null
    }
    if (aiTranscriberCustomListenerRef.current) {
      trtc.off(TRTC.EVENT.CUSTOM_MESSAGE, aiTranscriberCustomListenerRef.current)
      aiTranscriberCustomListenerRef.current = null
    }
    const handleMessage = (event: any) => {
      if (!event) return
      if (callStatusRef.current !== "active") return
      if (!liveListenRef.current) return
      const localId = trtcUserIdRef.current
      const speakerId = typeof event.speakerUserId === "string" ? event.speakerUserId : String(event.speakerUserId || "")
      if (localId && speakerId && speakerId !== localId) return
      const sourceText = typeof event.sourceText === "string" ? event.sourceText : ""
      const baseTranscript = sessionTranscriptRef.current
      const mergedTranscript = appendText(baseTranscript, sourceText)
      const translationTexts = Array.isArray(event.translationTexts) ? event.translationTexts : []
      const targetLang = aiTranscriberTargetLangRef.current
      const targetPrimary = targetLang ? primaryOf(targetLang) : ""
      const matchedTranslation = translationTexts.find((item: any) => {
        if (!item) return false
        const lang = typeof item.language === "string" ? item.language : ""
        return lang && (lang === targetLang || primaryOf(lang) === targetPrimary)
      })
      const translationText = typeof matchedTranslation?.text === "string" ? matchedTranslation.text : ""
      const baseTranslation = liveCommittedTranslationRef.current
      const mergedTranslation = appendText(baseTranslation, translationText)
      if (event.isCompleted) {
        sessionTranscriptRef.current = mergedTranscript
        setConfirmedTranscript(mergedTranscript)
        setLiveTranscript(mergedTranscript)
        if (mergedTranslation) {
          liveCommittedTranslationRef.current = mergedTranslation
          aiTranscriberTranslationRef.current = mergedTranslation
          setLiveTranslation(mergedTranslation)
        } else if (aiTranscriberSourceLangRef.current && aiTranscriberSourceLangRef.current === aiTranscriberTargetLangRef.current) {
          liveCommittedTranslationRef.current = mergedTranscript
          aiTranscriberTranslationRef.current = mergedTranscript
          setLiveTranslation(mergedTranscript)
        }
        setIsInterim(false)
      } else {
        setLiveTranscript(mergedTranscript)
        if (mergedTranslation) {
          aiTranscriberTranslationRef.current = mergedTranslation
          setLiveTranslation(mergedTranslation)
        } else if (aiTranscriberSourceLangRef.current && aiTranscriberSourceLangRef.current === aiTranscriberTargetLangRef.current) {
          setLiveTranslation(mergedTranscript)
        }
        setIsInterim(true)
      }
    }
    const handleState = (event: any) => {
      if (!event) return
      const robotId = aiTranscriberRobotIdRef.current
      if (robotId && event.transcriberRobotId && event.transcriberRobotId !== robotId) return
      if (event.state === "started") {
        setTrtcTranscriberActive(true)
        return
      }
      if (event.state === "stopped") {
        setTrtcTranscriberActive(false)
      }
      if (event.error) {
        setTrtcTranscriberActive(false)
        setTrtcTranscriberTranslationActive(false)
        toast({
          title: "TRTC 转录失败",
          description: event.errorMessage || String(event.error),
          variant: "destructive",
        })
      }
    }
    aiTranscriberListenerRef.current = handleMessage
    aiTranscriberStateListenerRef.current = handleState
    trtc.on(TRTC.EVENT.REALTIME_TRANSCRIBER_MESSAGE, handleMessage)
    trtc.on(TRTC.EVENT.REALTIME_TRANSCRIBER_STATE_CHANGED, handleState)
    const handleCustomMessage = (event: any) => {
      if (!event || callStatusRef.current !== "active") return
      let raw = ""
      if (typeof event.data === "string") {
        raw = event.data
      } else if (event.data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(event.data)
      } else if (ArrayBuffer.isView(event.data)) {
        raw = new TextDecoder().decode(event.data)
      }
      if (!raw) return
      let message: any = null
      try {
        message = JSON.parse(raw)
      } catch {
        return
      }
      if (!message || message.type !== 10000) return
      const payload = message.payload || {}
      const senderId = typeof message.sender === "string" ? message.sender : ""
      const text = typeof payload.text === "string" ? payload.text : ""
      const translationText = typeof payload.translation_text === "string" ? payload.translation_text : ""
      const translationLang = typeof payload.translation_language === "string" ? payload.translation_language : ""
      const end = Boolean(payload.end)
      if (!text && !translationText) return
      trtcCustomCaptionActiveRef.current = true
      const targetPrimary = primaryOf(targetLanguage.code)
      const translationPrimary = translationLang ? primaryOf(translationLang) : ""
      const canUseTranslation = !translationLang || translationPrimary === targetPrimary
      const isLocal = senderId && senderId === trtcUserIdRef.current
      if (isLocal) {
        if (text) {
          const baseTranscript = sessionTranscriptRef.current
          const mergedTranscript = end ? appendText(baseTranscript, text) : appendText(baseTranscript, text)
          if (end) {
            sessionTranscriptRef.current = mergedTranscript
            setConfirmedTranscript(mergedTranscript)
            setLiveTranscript(mergedTranscript)
            setIsInterim(false)
          } else {
            setLiveTranscript(mergedTranscript)
            setIsInterim(true)
          }
        }
        if (translationText && canUseTranslation) {
          const baseTranslation = liveCommittedTranslationRef.current
          const mergedTranslation = end ? appendText(baseTranslation, translationText) : appendText(baseTranslation, translationText)
          if (end) {
            liveCommittedTranslationRef.current = mergedTranslation
            aiTranscriberTranslationRef.current = mergedTranslation
            setLiveTranslation(mergedTranslation)
            setTrtcTranscriberTranslationActive(true)
          } else {
            aiTranscriberTranslationRef.current = mergedTranslation
            setLiveTranslation(mergedTranslation)
            setTrtcTranscriberTranslationActive(true)
          }
        }
        return
      }
      if (text) {
        const baseTranscript = remoteCommittedTranscriptRef.current
        const mergedTranscript = end ? appendText(baseTranscript, text) : appendText(baseTranscript, text)
        if (end) {
          remoteCommittedTranscriptRef.current = mergedTranscript
          setRemoteConfirmedTranscript(mergedTranscript)
          setRemoteLiveTranscript(mergedTranscript)
        } else {
          setRemoteLiveTranscript(mergedTranscript)
        }
      }
      if (translationText && canUseTranslation) {
        const baseTranslation = remoteCommittedTranslationRef.current
        const mergedTranslation = end ? appendText(baseTranslation, translationText) : appendText(baseTranslation, translationText)
        if (end) {
          remoteCommittedTranslationRef.current = mergedTranslation
          setRemoteLiveTranslation(mergedTranslation)
        } else {
          setRemoteLiveTranslation(mergedTranslation)
        }
      }
      if (callPeerRef.current?.name) {
        setRemoteLiveUserName(callPeerRef.current.name)
      }
    }
    aiTranscriberCustomListenerRef.current = handleCustomMessage
    trtc.on(TRTC.EVENT.CUSTOM_MESSAGE, handleCustomMessage)
  }, [appendText, primaryOf, targetLanguage.code, toast])

  const enterTRTCRoom = useCallback(async (roomIdStr: string, userId: string) => {
    try {
      await cleanupTrtc()

      const trtcUserId = await getTrtcUserId(userId)

      const roomIdNumeric = roomIdStr.split("").reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0)
      let safeRoomId = roomIdNumeric === 0 ? 1 : roomIdNumeric
      if (safeRoomId > 4294967294) safeRoomId = 4294967294

      const trtc = TRTC.create({
        assetsPath: "https://web.sdk.qcloud.com/trtc/webrtc/v5/assets/",
      })
      trtc.use(RealtimeTranscriber)
      trtcRef.current = trtc
      trtcUserIdRef.current = trtcUserId
      trtcRoomIdRef.current = safeRoomId
      bindTrtcRealtimeTranscriberEvents(trtc)

      const { userSig, sdkAppId } = await fetchUserSig(trtcUserId)

      trtc.on(TRTC.EVENT.REMOTE_AUDIO_AVAILABLE, (event: any) => {
        if (remoteAudioRef.current) {
          // TRTC v5 auto-plays if element is provided in some versions, or we play the stream.
          // But v5 usually: trtc.startRemoteAudio({ userId, streamType }) and it plays via internal mechanism or we attach?
          // Actually, v5: trtc.on(TRTC.EVENT.REMOTE_AUDIO_AVAILABLE, event => { trtc.startRemoteAudio({ userId: event.userId, streamType: event.streamType }) })
          // And it manages playback.
          // We can also use: trtc.startRemoteAudio({ userId: event.userId, streamType: event.streamType, element: remoteAudioRef.current })?
          // Let's assume standard behavior:
          (trtc as any).startRemoteAudio({ userId: event.userId, streamType: event.streamType })
        }
      })

      await trtc.enterRoom({
        roomId: safeRoomId,
        scene: TRTC.TYPE.SCENE_RTC,
        sdkAppId,
        userId: trtcUserId,
        userSig,
      })

      await trtc.startLocalAudio()

      const audioTrack = trtc.getAudioTrack()
      let startedTranscriber = false
      if (callLiveEnabled) {
        const sourceCode = sourceLanguage.code === "auto" ? uiLocaleToLanguageCode() : sourceLanguage.code
        startedTranscriber = await startTrtcRealtimeTranscriber({
          sourceLanguage: sourceCode,
          targetLanguage: targetLanguage.code,
          roomId: safeRoomId,
          userId: trtcUserId,
        })
      }
      if (audioTrack && !startedTranscriber) {
        if (tencentAsrRef.current) {
          tencentAsrRef.current.stop()
        }
        tencentAsrRef.current = new TencentASR({
          audioTrack,
          OnRecognitionResultChange: (res: any) => {
            if (res?.result?.voice_text_str) {
              setLiveTranscript(sessionTranscriptRef.current + res.result.voice_text_str)
              setIsInterim(true)
            }
          },
          OnSentenceEnd: (res: any) => {
            if (res?.result?.voice_text_str) {
              const text = res.result.voice_text_str
              sessionTranscriptRef.current += text
              setConfirmedTranscript(sessionTranscriptRef.current)
              setLiveTranscript(sessionTranscriptRef.current)
              setIsInterim(false)
            }
          },
          OnError: (err: any) => console.error("ASR Error", err)
        })
        tencentAsrRef.current.start()
      }

      setIsCallStreaming(true)

    } catch (e: any) {
      console.error("Enter TRTC Room failed", e)
      toast({ title: "语音通话连接失败", description: e.message || String(e), variant: "destructive" })
      resetCallState()
    }
  }, [bindTrtcRealtimeTranscriberEvents, callLiveEnabled, cleanupTrtc, resetCallState, sourceLanguage.code, startTrtcRealtimeTranscriber, targetLanguage.code, toast, uiLocaleToLanguageCode])

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
      await enterTRTCRoom(id, roomUserId)
      toast({ title: t("call.acceptedTitle"), description: t("call.acceptedDesc", { name: peer.name }) })
    } catch (e) {
      console.error("Failed to accept call", e)
      toast({ title: t("call.failedTitle"), description: t("call.failedDesc"), variant: "destructive" })
      resetCallState()
    }
  }, [callIdRef, callPeerRef, enterTRTCRoom, roomUserId, sendSignal, t, toast, userName, resetCallState])

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

  const handleToggleCallLive = useCallback(() => {
    setCallLiveEnabled((prev) => {
      const next = !prev
      if (!next) {
        setLiveTranscript("")
        setConfirmedTranscript("")
        setLiveTranslation("")
        setLiveTranscriptLines([])
        setLiveTranslationLines([])
        liveCommittedTranscriptRef.current = ""
        liveCommittedTranslationRef.current = ""
        if (liveAutoBreakTimerRef.current) {
          clearTimeout(liveAutoBreakTimerRef.current)
          liveAutoBreakTimerRef.current = null
        }
        const peer = callPeerRef.current
        const id = callIdRef.current
        if (callStatusRef.current === "active" && peer?.id && id) {
          void sendSignal(peer.id, {
            type: "call_caption",
            callId: id,
            fromUserId: roomUserId,
            fromUserName: userName || t("call.unknownUser"),
            toUserId: peer.id,
            transcript: "",
            translation: "",
            sourceLanguage: sourceLanguage.code,
            targetLanguage: targetLanguage.code,
            timestamp: Date.now(),
          } as CallSignalPayload).catch(() => { })
        }
        void stopTrtcRealtimeTranscriber()
      } else if (callStatusRef.current === "active" && trtcUserIdRef.current && trtcRoomIdRef.current) {
        const sourceCode = sourceLanguage.code === "auto" ? uiLocaleToLanguageCode() : sourceLanguage.code
        void startTrtcRealtimeTranscriber({
          sourceLanguage: sourceCode,
          targetLanguage: targetLanguage.code,
          roomId: trtcRoomIdRef.current,
          userId: trtcUserIdRef.current,
        })
      }
      return next
    })
  }, [roomUserId, sendSignal, sourceLanguage.code, startTrtcRealtimeTranscriber, stopTrtcRealtimeTranscriber, t, targetLanguage.code, uiLocaleToLanguageCode, userName])

  const resolveLanguageCode = useCallback((value: string): string => {
    const byCode = SUPPORTED_LANGUAGES.find((l) => l.code === value)
    if (byCode) return byCode.code
    const byName = SUPPORTED_LANGUAGES.find((l) => l.name === value)
    if (byName) return byName.code
    return value
  }, [])

  const splitIntoSentences = useCallback((text: string) => {
    const input = typeof text === "string" ? text : ""
    const normalized = input.replace(/\s+/g, " ").trim()
    if (!normalized) return [] as string[]
    const matches = normalized.match(/[^。！？.!?]+[。！？.!?]+|[^。！？.!?]+$/g)
    return (matches ?? []).map((s) => s.trim()).filter(Boolean)
  }, [])

  const getDeltaText = useCallback((full: string, committed: string) => {
    const base = typeof full === "string" ? full : ""
    const committedText = typeof committed === "string" ? committed : ""
    if (committedText && base.startsWith(committedText)) {
      return base.slice(committedText.length).trimStart()
    }
    return base.trim()
  }, [])


  const commitLiveCaption = useCallback(
    (fullTranscript: string, fullTranslation: string) => {
      const deltaTranscript = getDeltaText(fullTranscript, liveCommittedTranscriptRef.current)
      const deltaTranslation = typeof fullTranslation === "string" ? fullTranslation.trim() : ""
      if (!deltaTranscript && !deltaTranslation) return

      const transcriptLines = splitIntoSentences(deltaTranscript)
      const translationLines = splitIntoSentences(deltaTranslation)

      setLiveTranscriptLines((prev) => {
        const next = [...prev, ...transcriptLines]
        return next.slice(-20)
      })
      setLiveTranslationLines((prev) => {
        const next = [...prev, ...translationLines]
        return next.slice(-20)
      })

      liveCommittedTranscriptRef.current = fullTranscript.trim()
      if (deltaTranslation) {
        const prev = liveCommittedTranslationRef.current
        liveCommittedTranslationRef.current = prev ? `${prev} ${deltaTranslation}`.trim() : deltaTranslation
      }
    },
    [getDeltaText, splitIntoSentences],
  )

  // Moved definition to top

  useEffect(() => {
    if (callStatus !== "active") return
    const startAt = Date.now()
    setCallDurationSec(0)
    const timer = setInterval(() => {
      setCallDurationSec(Math.floor((Date.now() - startAt) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [callStatus])

  useEffect(() => {
    if (callStatus !== "active") return
    const stream = callStreamRef.current
    if (!stream) return
    for (const track of stream.getAudioTracks()) {
      track.enabled = !isCallMuted
    }
  }, [callStatus, isCallMuted])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!isInRoom) return

    if (!shouldLiveListen) {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.onresult = null
          speechRecognitionRef.current.onerror = null
          speechRecognitionRef.current.onend = null
          speechRecognitionRef.current.stop()
        } catch { }
        speechRecognitionRef.current = null
      }
      stopFallbackLive()
      return
    }

    // Priority: Tencent Cloud Streaming ASR > Browser Native ASR
    // Since the user explicitly configured Tencent Cloud ASR, we prioritize the WebSocket implementation (startFallbackLive)
    // over the browser's native SpeechRecognition.
    // This ensures we use the high-quality, continuous streaming recognition from Tencent.

    // Check if we should use native SpeechRecognition (only if NOT using Tencent)
    // For now, we force fallback (Tencent/HTTP) to ensure Tencent ASR is used if available.
    // If you want to use browser native ASR when Tencent is not configured, we would need a flag.
    // Given the user's request, we skip SpeechRecognition.

    /*
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
      mozSpeechRecognition?: SpeechRecognitionConstructor
    }
    const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? w.mozSpeechRecognition
    if (!SpeechRecognition) {
      void startFallbackLive()
      return
    }
    setLiveSpeechSupported(true)
    stopFallbackLive()

    const recognition = new SpeechRecognition()
    // ... (rest of SpeechRecognition setup)
    return () => { ... }
    */

    // Force use of our custom streaming implementation (Tencent ASR)
    void startFallbackLive()
    setLiveSpeechSupported(true) // We support it via fallback

    return () => {
      stopFallbackLive()
    }

  }, [isInRoom, shouldLiveListen, sourceLanguage.code, startFallbackLive, stopFallbackLive, uiLocaleToLanguageCode])

  useEffect(() => {
    if (!isInRoom) return
    if (trtcTranscriberTranslationActive) return
    const detected = detectLanguageFromText(liveTranscript)
    // Prioritize detected language if it's Chinese (high confidence), otherwise use raw source or auto detection
    // This fixes the issue where user selects "English" but speaks Chinese (supported by 16k_zh mixed model),
    // preventing the local translation box from showing Chinese transcript when target is English.
    const sourceCode =
      detected === "zh-CN"
        ? "zh-CN"
        : sourceLanguage.code === "auto"
          ? detected
          : sourceLanguage.code

    const targetCode = targetLanguage.code
    const sourcePrimary = primaryOf(sourceCode)
    const targetPrimary = primaryOf(targetCode)
    if (liveTranslateTimerRef.current) {
      clearTimeout(liveTranslateTimerRef.current)
      liveTranslateTimerRef.current = null
    }

    const fullTranscript = typeof liveTranscript === "string" ? liveTranscript.trim() : ""

    if (!fullTranscript) {
      setLiveTranslation("")
      return
    }

    // If source and target languages are effectively the same (e.g. both English),
    // and the detected language is ALSO the same, we skip translation and show original text.
    // BUT if the detected language is different (e.g. speaking Chinese while set to English),
    // we MUST translate, even if the user manually selected English as source.
    if (sourcePrimary === targetPrimary && primaryOf(detected) === sourcePrimary) {
      setLiveTranslation(fullTranscript)
      return
    }

    liveTranslateTimerRef.current = setTimeout(() => {
      if (liveTranslateAbortRef.current) liveTranslateAbortRef.current.abort()
      const controller = new AbortController()
      liveTranslateAbortRef.current = controller

      void translateText(fullTranscript, sourceCode, targetCode, controller.signal)
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
  }, [isInRoom, liveTranscript, primaryOf, sourceLanguage.code, targetLanguage.code, trtcTranscriberTranslationActive])

  useEffect(() => {
    if (!shouldLiveListen) return
    if (!liveTranscript.trim() && !liveTranslation.trim()) return
    if (liveAutoBreakTimerRef.current) {
      clearTimeout(liveAutoBreakTimerRef.current)
      liveAutoBreakTimerRef.current = null
    }
    liveAutoBreakTimerRef.current = setTimeout(() => {
      commitLiveCaption(liveTranscript, liveTranslation)
    }, 2500)
    return () => {
      if (liveAutoBreakTimerRef.current) {
        clearTimeout(liveAutoBreakTimerRef.current)
        liveAutoBreakTimerRef.current = null
      }
    }
  }, [commitLiveCaption, liveTranscript, liveTranslation, shouldLiveListen])

  const normalizeLiveDisplay = (text: string, languageHint: string) => {
    const raw = typeof text === "string" ? text : ""
    const trimmed = raw.replace(/\s+/g, " ").trim()
    if (!trimmed) return ""
    const sample = trimmed
    const primary = primaryOf(languageHint)
    const isCjk = ["zh", "ja", "ko"].includes(primary ?? "") || /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(sample)
    if (isCjk) {
      return trimmed
        .replace(/([\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])\s+([\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])/g, "$1$2")
        .replace(/\s*([。！？!?，、；：])\s*/g, "$1")
        .trim()
    }
    return trimmed.replace(/\s+([,.!?;:])/g, "$1")
  }

  const formattedLiveTranscript = (() => {
    return normalizeLiveDisplay(liveTranscript, sourceLanguage.code)
  })()

  const formattedLiveTranslation = (() => {
    return normalizeLiveDisplay(liveTranslation, targetLanguage.code)
  })()

  const formattedConfirmedTranscript = (() => {
    return normalizeLiveDisplay(confirmedTranscript, sourceLanguage.code)
  })()

  useEffect(() => {
    if (callStatus !== "active") return
    const transcript = remoteLiveTranscript.trim()
    if (!transcript) {
      setRemoteLiveTranslation("")
      if (remoteTranslateTimerRef.current) {
        clearTimeout(remoteTranslateTimerRef.current)
        remoteTranslateTimerRef.current = null
      }
      if (remoteTranslateAbortRef.current) {
        remoteTranslateAbortRef.current.abort()
        remoteTranslateAbortRef.current = null
      }
      return
    }
    const detectedSource = detectLanguageFromText(transcript)
    const rawSource = remoteLiveSourceLanguage.trim()
    const normalizedSource = rawSource.toLowerCase()
    // Prioritize detected language if it's Chinese (high confidence), otherwise use raw source or auto detection
    const sourceCode =
      detectedSource === "zh-CN"
        ? "zh-CN"
        : !rawSource || normalizedSource === "auto" || normalizedSource === "自动识别"
          ? detectedSource
          : rawSource
    const targetCode = targetLanguage.code
    const sourcePrimary = primaryOf(sourceCode)
    const detectedPrimary = primaryOf(detectedSource)
    const targetPrimary = primaryOf(targetCode)

    remoteTranslateLatestRef.current = transcript
    remoteTranslateSourceRef.current = sourceCode
    remoteTranslateTargetRef.current = targetCode

    if (detectedPrimary && sourcePrimary && detectedPrimary !== sourcePrimary) {
      setRemoteLiveSourceLanguage(detectedSource)
    }

    if (sourcePrimary === targetPrimary && (!detectedPrimary || detectedPrimary === sourcePrimary)) {
      setRemoteLiveTranslation(transcript)
      return
    }

    // Force local translation if remote translation seems incorrect (e.g. language mismatch)
    // This handles the case where sender sent a translation but it's in the wrong language (e.g. Sender Target=ZH, Receiver Target=EN)
    const currentRemoteTrans = remoteLiveTranslation.trim()
    if (currentRemoteTrans) {
      const currentTransLang = detectLanguageFromText(currentRemoteTrans)
      const currentTransPrimary = primaryOf(currentTransLang)
      // If we have a translation, but it's not in our target language, and detected source IS different from target
      // Then we must re-translate.
      if (currentTransPrimary !== targetPrimary && detectedPrimary !== targetPrimary) {
        // Fall through to translation
      } else {
        // Trust the remote translation if language matches
        // But wait, what if remote translation hasn't updated yet? 
        // The effect dependency includes remoteLiveTranscript.
      }
    }

    // Force update remote translation if we have a direct translation from the sender
    // This happens when the sender (desktop) has already translated the text and sent it via call_caption
    // We should trust the sender's translation if available, as they have the original audio context
    // However, the current signal handling logic might be overwriting this with local re-translation
    // Let's check how 'transcript' is populated. It comes from 'remoteLiveTranscript' state.
    // The 'call_caption' handler updates 'remoteLiveTranscript' with the sender's transcript.
    // It also updates 'remoteLiveTranslation' with the sender's translation directly.
    // BUT this effect runs whenever 'remoteLiveTranscript' changes, and triggers a LOCAL translation
    // which might overwrite the sender's translation with an empty or pending state.

    // Fix: If the remote transcript hasn't changed significantly, or if we just received a caption signal,
    // we should debouce or skip local re-translation to avoid flickering/interruption.
    // For now, let's just ensure we don't clear the translation unnecessarily.
    // IMPORTANT: If we already have a translation from the peer (which is updated via signal), 
    // we should prefer it. But how do we know if 'remoteLiveTranslation' was set by signal or by this effect?
    // We can check if 'remoteLiveTranslation' is already consistent with 'transcript' via some heuristic,
    // but simpler is to just let this effect run but with a check: 
    // If the current 'remoteLiveTranslation' is NOT empty and seems to match the transcript length roughly, maybe delay overwriting?

    // Actually, the issue is likely that when 'remoteLiveTranscript' updates via signal, 
    // 'remoteLiveTranslation' also updates via signal IMMEDIATELY.
    // THEN this effect runs because 'remoteLiveTranscript' changed.
    // This effect then calls 'translateText', which is async. 
    // While it waits, it might NOT clear the state, but if it does, or if the translation result comes back differently/later, it overwrites.

    // If the signal provides translation, we should arguably SKIP this local translation entirely for that specific update.
    // But we don't know if the signal provided translation here easily without extra state.
    // HOWEVER, we can observe that 'call_caption' signals are the ONLY source of 'remoteLiveTranscript' updates in this MVP.
    // And 'call_caption' ALWAYS includes 'translation' field (even if empty).
    // So if the peer sent a translation, we should use it.
    // If the peer sent empty translation (e.g. same language), we might need to translate locally? 
    // No, if peer is same language, they send text as translation.

    // So: why do we translate locally at all? 
    // Answer: We translate locally only if the peer DID NOT send a translation OR if we want to support receiver-side language settings overriding sender side.
    // But currently the system design seems to rely on SENDER doing the translation (based on sender's target setting? No, sender sends THEIR target setting).
    // Wait, 'call_caption' payload has 'targetLanguage'.
    // If receiver has different target language, receiver MUST re-translate.
    // If receiver has SAME target language as sender, receiver SHOULD use sender's translation.

    const receiverTarget = targetLanguage.code
    // We don't have sender's target language readily available in this effect scope easily unless we store it.
    // But we can check if we should trust the current state.

    // Let's optimize: only translate if the current remoteLiveTranslation is empty OR if enough time passed?
    // No, that's flaky.

    // Better fix: rely on the fact that `setRemoteLiveTranslation` in the signal handler happens BEFORE this effect.
    // If this effect runs, it schedules a translation.
    // If we want to prevent overwriting the valid translation from signal, we should check if we really need to translate.
    // But we don't know if the signal translation is valid for OUR target language.

    // Let's assume for now we ALWAYS translate locally to ensure it matches RECEIVER's target language preference.
    // The issue described by user is "interruption" or "not showing".
    // This suggests a race condition or UI hiding logic.
    // The user says "displayed these info then stopped showing".
    // This implies it showed PARTIAL results then disappeared? Or showed previous sentence then stopped?
    // "Stopped showing" could mean the `formattedRemote` logic filters it out?
    // Or `remoteLiveTranslation` becomes empty?

    // In lines 954-956: if (!transcript) setRemoteLiveTranslation("")
    // This clears translation if transcript is empty. Correct.

    // In lines 987+: We start a timeout to translate.
    // If we receive a stream of characters: "H", "He", "Hel", "Hell", "Hello".
    // Each update triggers this effect.
    // "H" -> schedule translate 150ms.
    // "He" -> clear "H" timer, schedule "He" 150ms.
    // ...
    // "Hello" -> clear "Hell" timer, schedule "Hello" 150ms.
    // If signal comes every 100ms, the timer never fires! 
    // So we NEVER translate locally while typing/speaking continuously!
    // AND if the signal does NOT contain a translation (or contains partial), we see nothing.
    // BUT the signal from sender SHOULD contain translation if sender is translating.

    // If sender is desktop, it translates locally and sends `translation` field.
    // The signal handler (line 1100+) does:
    // setRemoteLiveTranscript(payload.transcript)
    // setRemoteLiveTranslation(payload.translation)

    // So we get "Hello" + "你好" from signal.
    // UI updates.
    // Effect runs for "Hello".
    // Clears timer. Schedules local translate.
    // If new signal comes "Hello world" + "你好世界" before 150ms:
    // UI updates to "Hello world" + "你好世界".
    // Effect runs. Clears timer. Schedules new translate.
    // This seems fine? We just keep displaying the sender's translation.

    // Wait, why did the user say "display stopped"?
    // Maybe `remoteLiveTranslation` is getting CLEARED somewhere?
    // Only line 955 clears it.

    // Or maybe the UI logic for `formattedRemote...` is hiding it?
    // Let's look at `formattedRemoteLiveTranscript` and `formattedRemoteLiveTranslation`.
    // We need to see that code.

    const scheduleTranslate = () => {
      if (remoteTranslateTimerRef.current) return
      remoteTranslateTimerRef.current = setTimeout(() => {
        const latestTranscript = remoteTranslateLatestRef.current.trim()
        if (!latestTranscript) {
          remoteTranslateTimerRef.current = null
          return
        }
        if (remoteTranslateAbortRef.current) remoteTranslateAbortRef.current.abort()
        const controller = new AbortController()
        remoteTranslateAbortRef.current = controller
        const source = remoteTranslateSourceRef.current
        const target = remoteTranslateTargetRef.current
        void translateText(latestTranscript, source, target, controller.signal)
          .then((translated) => {
            if (!controller.signal.aborted) setRemoteLiveTranslation(translated)
          })
          .catch(() => { })
          .finally(() => {
            if (remoteTranslateAbortRef.current === controller) remoteTranslateAbortRef.current = null
            remoteTranslateTimerRef.current = null
            if (remoteTranslateLatestRef.current.trim() !== latestTranscript) {
              scheduleTranslate()
            }
          })
      }, 150)
    }
    scheduleTranslate()

    return () => {
      if (remoteTranslateAbortRef.current) {
        remoteTranslateAbortRef.current.abort()
        remoteTranslateAbortRef.current = null
      }
    }
  }, [callStatus, detectLanguageFromText, primaryOf, remoteLiveSourceLanguage, remoteLiveTranscript, targetLanguage.code])

  useEffect(() => {
    return () => {
      if (remoteTranslateTimerRef.current) {
        clearTimeout(remoteTranslateTimerRef.current)
        remoteTranslateTimerRef.current = null
      }
      if (remoteTranslateAbortRef.current) {
        remoteTranslateAbortRef.current.abort()
        remoteTranslateAbortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (callStatus !== "active") return
    if (!settings.autoPlayTranslations) return
    const full = remoteLiveTranslation.trim()
    if (!full) {
      remoteSpokenTranslationRef.current = ""
      remoteLastSpokenTextRef.current = ""
      if (ttsDeferredTimerRef.current) {
        clearTimeout(ttsDeferredTimerRef.current)
        ttsDeferredTimerRef.current = null
      }
      ttsDeferredTextRef.current = ""
      ttsDeferredFullRef.current = ""
      return
    }
    const lastFull = remoteSpokenTranslationRef.current
    const delta = lastFull && full.startsWith(lastFull)
      ? full.slice(lastFull.length)
      : splitIntoSentences(full).slice(-1)[0] ?? ""
    const text = delta.trim()
    if (!text) return
    if (text === remoteLastSpokenTextRef.current) return
    if (ttsSupported && !ttsUnlockedRef.current) {
      pendingTtsRef.current = { text, lang: targetLanguage.code }
      return
    }
    const shouldSpeak = /[。！？.!?]$/.test(text) || text.length >= 20
    if (!shouldSpeak) {
      if (ttsDeferredTimerRef.current) {
        clearTimeout(ttsDeferredTimerRef.current)
      }
      ttsDeferredTextRef.current = text
      ttsDeferredFullRef.current = full
      ttsDeferredTimerRef.current = setTimeout(() => {
        if (ttsDeferredTextRef.current !== text) return
        if (remoteLastSpokenTextRef.current === text) return
        if (ttsSupported && !ttsUnlockedRef.current) {
          pendingTtsRef.current = { text, lang: targetLanguage.code }
          return
        }
        speak(text, targetLanguage.code)
        remoteSpokenTranslationRef.current = ttsDeferredFullRef.current
        remoteLastSpokenTextRef.current = text
      }, 1000)
      return
    }
    if (ttsDeferredTimerRef.current) {
      clearTimeout(ttsDeferredTimerRef.current)
      ttsDeferredTimerRef.current = null
    }
    speak(text, targetLanguage.code)
    remoteSpokenTranslationRef.current = full
    remoteLastSpokenTextRef.current = text
  }, [
    callStatus,
    isMobile,
    remoteLiveTranslation,
    settings.autoPlayTranslations,
    speak,
    splitIntoSentences,
    targetLanguage.code,
    toast,
    ttsSupported,
  ])

  useEffect(() => {
    if (!ttsSupported) return
    const tryUnlock = () => {
      if (ttsUnlockedRef.current || ttsUnlockingRef.current) return
      ttsUnlockingRef.current = true
      void unlockTts().then((ok) => {
        ttsUnlockingRef.current = false
        if (!ok) return
        ttsUnlockedRef.current = true
        const pending = pendingTtsRef.current
        if (pending) {
          pendingTtsRef.current = null
          speak(pending.text, pending.lang)
        }
      })
    }
    const events = ["pointerdown", "touchstart", "click", "keydown"] as const
    events.forEach((e) => window.addEventListener(e, tryUnlock, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, tryUnlock))
  }, [speak, ttsSupported, unlockTts])

  useEffect(() => {
    if (!settings.autoPlayTranslations) return
    if (ttsSupported) return
    if (ttsUnsupportedNotifiedRef.current) return
    ttsUnsupportedNotifiedRef.current = true
    toast({
      title: "当前浏览器不支持语音播放",
      description: "请使用系统浏览器或关闭静音模式后再试。",
      variant: "destructive",
    })
  }, [settings.autoPlayTranslations, toast, ttsSupported])

  const handleUnlockTts = useCallback(async () => {
    if (!ttsSupported) {
      toast({
        title: "当前浏览器不支持语音播放",
        description: "请使用系统浏览器或关闭静音模式后再试。",
        variant: "destructive",
      })
      return
    }
    if (ttsUnlockingRef.current || ttsUnlockedRef.current) return
    ttsUnlockingRef.current = true
    const ok = await unlockTts()
    ttsUnlockingRef.current = false
    if (!ok) {
      toast({
        title: "语音播放未解锁",
        description: "请点击页面后再尝试启用语音播放。",
        variant: "destructive",
      })
      return
    }
    const pending = pendingTtsRef.current
    if (pending) {
      pendingTtsRef.current = null
      speak(pending.text, pending.lang)
    }
  }, [speak, toast, ttsSupported, unlockTts])

  const playBeep = useCallback(async () => {
    try {
      if (typeof window === "undefined") return { ok: false, state: "no-window" }
      const AudioContextImpl = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextImpl) return { ok: false, state: "no-audio-context" }
      const ctx = new AudioContextImpl()
      const initialState = ctx.state
      if (ctx.state === "suspended") {
        await ctx.resume()
      }
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.2
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.25)
      setTimeout(() => {
        ctx.close()
      }, 400)
      return { ok: true, state: initialState }
    } catch {
      return { ok: false, state: "error" }
    }
  }, [])

  // Keep a ref to the test audio to prevent GC
  const testAudioRef = useRef<HTMLAudioElement | null>(null)

  const handleTestTts = useCallback(async () => {
    // 1. Try standard TTS
    speakWithOptions("语音测试", targetLanguage.code, { volume: 1.0, rate: 1.0, immediate: true })

    // 2. Synchronously create and play Online TTS as backup
    try {
      const text = "语音测试"
      const proxyUrl = `/api/tts?text=${encodeURIComponent(text)}&lang=${targetLanguage.code}`
      
      // Stop previous test audio if playing
      if (testAudioRef.current) {
        testAudioRef.current.pause()
        testAudioRef.current = null
      }

      const audio = new Audio(proxyUrl)
      testAudioRef.current = audio
      audio.volume = 1.0
      
      let hasPlayed = false
      audio.onplay = () => { hasPlayed = true }
      audio.onerror = (e) => {
        console.error("Direct Audio error:", e)
        // If online audio fails, try beep as last resort
        playBeep().then(res => {
          if (!res.ok) {
            toast({
               title: "音频系统故障",
               description: "无法播放网络语音，且无法启动蜂鸣器，请检查系统音频。",
               variant: "destructive"
            })
          } else {
             toast({
               title: "网络语音失败",
               description: "已播放蜂鸣提示音。可能是服务端代理无法连接语音服务器。",
               variant: "destructive"
            })
          }
        })
      }

      const p = audio.play()
      if (p !== undefined) {
        p.catch(error => {
          console.error("Direct Audio play failed:", error)
          // If play blocked or failed
          playBeep().then(() => {
             toast({
               title: "语音播放被拦截",
               description: `错误: ${error.message || "未知错误"}。已尝试蜂鸣。`,
               variant: "destructive"
            })
          })
        })
      }

    } catch (e) {
      console.error("Direct Audio setup failed:", e)
      playBeep()
    }

  }, [playBeep, speakWithOptions, targetLanguage.code, toast])

  useEffect(() => {
    const el = remoteAudioRef.current
    if (!el) return
    if (callStatus !== "active") return
    const hasStream = Boolean(el.srcObject)
    if (!hasStream) return
    el.muted = settings.onlyHearTranslatedVoice
    if (!settings.onlyHearTranslatedVoice) {
      void el.play().catch(() => { })
    }
  }, [callStatus, settings.onlyHearTranslatedVoice])

  useEffect(() => {
    if (callStatus !== "active") return
    if (!callPeer?.id || !callId) return
    if (!callLiveEnabled) return
    if (!formattedLiveTranscript.trim() && !formattedLiveTranslation.trim()) return
    const textToDetect = formattedLiveTranscript || liveTranscript
    const detected = detectLanguageFromText(textToDetect)
    const outgoingSource =
      detected === "zh-CN"
        ? "zh-CN"
        : sourceLanguage.code === "auto"
          ? detected
          : sourceLanguage.code
    if (liveCaptionSendTimerRef.current) {
      clearTimeout(liveCaptionSendTimerRef.current)
      liveCaptionSendTimerRef.current = null
    }
    liveCaptionSendTimerRef.current = setTimeout(() => {
      void sendSignal(callPeer.id, {
        type: "call_caption",
        callId,
        fromUserId: roomUserId,
        fromUserName: userName || t("call.unknownUser"),
        toUserId: callPeer.id,
        transcript: formattedLiveTranscript,
        confirmedTranscript: formattedConfirmedTranscript,
        translation: formattedLiveTranslation,
        sourceLanguage: outgoingSource,
        targetLanguage: targetLanguage.code,
        timestamp: Date.now(),
      } as CallSignalPayload).catch(() => { })
    }, 100)
    return () => {
      if (liveCaptionSendTimerRef.current) {
        clearTimeout(liveCaptionSendTimerRef.current)
        liveCaptionSendTimerRef.current = null
      }
    }
  }, [callId, callLiveEnabled, callPeer?.id, callStatus, detectLanguageFromText, formattedLiveTranscript, formattedLiveTranslation, liveTranscript, roomUserId, sendSignal, sourceLanguage.code, t, targetLanguage.code, userName])

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

              // Fix for "single call limitation":
              // If we receive an invite from the same user we are currently in a "call" with (or trying to call),
              // it means the previous session is likely dead/stuck on their end.
              // We should force reset our state to accept the new call.
              if (callStatusRef.current !== "idle" && callPeerRef.current?.id === fromId) {
                console.log("[v0] Received invite from current peer, resetting stuck state")
                resetCallState()
              }

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
                  void enterTRTCRoom(callIdRef.current || acceptId, roomUserId).catch(() => { })
                  toast({ title: t("call.acceptedTitle"), description: t("call.acceptedDesc", { name: fromName }) })
                }
              }
              continue
            }

            if (type === "call_caption") {
              const incomingId = String(payload.callId || "")
              if (callStatusRef.current !== "active" || (incomingId && callIdRef.current && incomingId !== callIdRef.current)) {
                continue
              }
              if (trtcCustomCaptionActiveRef.current) {
                continue
              }
              const transcript = typeof payload.transcript === "string" ? payload.transcript : ""
              const confirmedTranscript = typeof payload.confirmedTranscript === "string" ? payload.confirmedTranscript : ""
              const translation = typeof payload.translation === "string" ? payload.translation : ""
              const sourceLang = typeof payload.sourceLanguage === "string" ? payload.sourceLanguage : ""

              setRemoteLiveTranscript(transcript)
              setRemoteConfirmedTranscript(confirmedTranscript)

              // Only update translation from signal if it's valid and matches our target language preference
              // Heuristic: If translation language is significantly different from our target, ignore it.
              // e.g. We want EN, but got ZH translation (or no translation, i.e. same as source).
              const targetPrimary = targetLanguage.code.split("-")[0]
              const translationLang = detectLanguageFromText(translation)
              const translationPrimary = translationLang.split("-")[0]

              // If translation is provided
              if (translation) {
                // If we strictly expect EN, but got ZH, and translation equals transcript (meaning no translation), ignore it.
                // Or if translation is just totally different from target.
                // But sometimes "你好" -> "Hello" is correct.
                // If translation is "你好" (ZH) and target is EN, then it's wrong.
                if (targetPrimary !== translationPrimary && targetPrimary === "en" && translationPrimary === "zh") {
                  // Ignore remote translation, let local translation handle it
                } else {
                  setRemoteLiveTranslation(translation)
                }
              } else if (!transcript) {
                setRemoteLiveTranslation("")
              }

              const normalizedSourceLang = sourceLang.trim().toLowerCase()
              setRemoteLiveSourceLanguage(!normalizedSourceLang || normalizedSourceLang === "auto" || normalizedSourceLang === "自动识别" ? "" : sourceLang)
              setRemoteLiveUserName(fromName)
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
        setConfirmedTranscript("")
        setLiveTranslation("")
        setLiveTranscriptLines([])
        setLiveTranslationLines([])
        liveCommittedTranscriptRef.current = ""
        liveCommittedTranslationRef.current = ""
        if (liveAutoBreakTimerRef.current) {
          clearTimeout(liveAutoBreakTimerRef.current)
          liveAutoBreakTimerRef.current = null
        }
      }
    },
    [exitRoom, roomId, roomUserId, sourceLanguage.code, t, toast, targetLanguage.code, userName],
  )

  if (!isInRoom) {
    return <RoomJoin onJoin={handleJoinRoom} initialRoomId={urlRoomId} autoJoin={autoJoin || Boolean(urlRoomId)} />
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsUsersSheetOpen(true)}
                className="h-9 md:hidden"
              >
                <Phone className="w-4 h-4 mr-2" />
                语音通话
              </Button>
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

            {callStatus === "active" && callPeer ? (
              <div className="shrink-0 border-b border-border bg-muted/20 px-3 py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={callPeerUser?.avatar || ""} alt={callPeer.name} />
                    <AvatarFallback>{callPeer.name?.slice(0, 1) || "?"}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{callPeer.name}</div>
                    <div className="text-xs text-muted-foreground">{t("call.acceptedDesc", { name: callPeer.name })}</div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono tabular-nums">
                    {formatCallDuration(callDurationSec)}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant={isCallMuted ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setIsCallMuted((prev) => !prev)}
                    className="h-9"
                    aria-label={isCallMuted ? t("call.unmute") : t("call.mute")}
                  >
                    {isCallMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    <span className="ml-2">{isCallMuted ? t("call.unmute") : t("call.mute")}</span>
                  </Button>
                  <Button
                    variant={callLiveEnabled ? "secondary" : "outline"}
                    size="sm"
                    onClick={handleToggleCallLive}
                    className="h-9"
                    aria-label={t("voice.liveTranslationTitle")}
                  >
                    {t("voice.liveTranslationTitle")}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleEndCall} className="h-9">
                    <PhoneOff className="w-4 h-4" />
                    <span className="ml-2">{t("call.hangup")}</span>
                  </Button>
                </div>
              </div>
            ) : null}

            <ChatArea
              variant="embedded"
              messages={messages}
              speechRate={settings.speechRate}
              speechVolume={settings.speechVolume}
              autoPlay={settings.autoPlayTranslations && callStatus !== "active"}
            />

            <div className="shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border shadow-sm">
              {(isRecording ||
                isProcessing ||
                callStatus === "active") &&
                (formattedLiveTranslation.trim() ||
                  remoteLiveTranslation.trim() ||
                  (callStatus === "active" && callLiveEnabled && formattedLiveTranscript.trim()) ||
                  (callStatus === "active" && remoteLiveTranscript.trim()) ||
                  !liveSpeechSupported) ? (
                <div className="absolute bottom-full left-0 right-0 p-4 bg-gradient-to-t from-background via-background/90 to-transparent pointer-events-none flex justify-center">
                  <div className="w-full max-w-4xl bg-card/95 border shadow-lg rounded-xl p-4 pointer-events-auto backdrop-blur animate-in fade-in slide-in-from-bottom-2">
                    {!liveSpeechSupported ? (
                      <div className="text-xs text-muted-foreground">{t("voice.liveUnsupported")}</div>
                    ) : null}
                    {(callStatus === "active" && callLiveEnabled && liveTranscript.trim()) ? (
                      <div className="mb-4">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                          {userName || "我"}
                        </div>
                        <div className="text-base leading-relaxed whitespace-pre-wrap break-all">
                          <span className="text-foreground font-bold">{confirmedTranscript}</span>
                          <span className={isInterim ? "text-muted-foreground text-sm" : "text-foreground font-bold"}>
                            {liveTranscript.slice(confirmedTranscript.length)}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    {remoteLiveTranslation.trim() ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="order-2 md:order-1">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            {remoteLiveUserName ? `${remoteLiveUserName} · ${t("voice.liveTranslationTitle")}` : t("voice.liveTranslationTitle")}
                          </div>
                          <div className="text-base font-medium leading-relaxed text-primary whitespace-pre-wrap">{remoteLiveTranslation}</div>
                        </div>
                        {/* Show original transcript on the right if available, or just empty space utilization */}
                        {remoteLiveTranscript.trim() && (
                          <div className="order-1 md:order-2 opacity-60">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                              {t("voice.originalTranscript")}
                            </div>
                            <div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                              <span className="text-foreground font-medium">{remoteConfirmedTranscript}</span>
                              <span className="opacity-70">{remoteLiveTranscript.slice(remoteConfirmedTranscript.length)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : callStatus === "active" && remoteLiveTranscript.trim() ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="order-2 md:order-1">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            {remoteLiveUserName ? `${remoteLiveUserName} · ${t("voice.liveTranslationTitle")}` : t("voice.liveTranslationTitle")}
                          </div>
                          <div className="text-sm text-muted-foreground animate-pulse">正在翻译…</div>
                        </div>
                        <div className="order-1 md:order-2 opacity-60">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            {t("voice.originalTranscript")}
                          </div>
                          <div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                            <span className="text-foreground font-medium">{remoteConfirmedTranscript}</span>
                            <span className="opacity-70">{remoteLiveTranscript.slice(remoteConfirmedTranscript.length)}</span>
                          </div>
                        </div>
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
                    {isMobile && settings.autoPlayTranslations ? (
                      <div className="mt-1 flex items-center gap-1">
                        <Button
                          variant={isTtsUnlocked ? "secondary" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={handleUnlockTts}
                          disabled={!ttsSupported}
                        >
                          {isTtsUnlocked ? "语音已启用" : "启用语音"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={handleTestTts}
                          disabled={!ttsSupported}
                        >
                          测试
                        </Button>
                      </div>
                    ) : null}
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
                    {settings.autoPlayTranslations ? (
                      <div className="mt-1 flex items-center gap-1">
                        <Button
                          variant={isTtsUnlocked ? "secondary" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={handleUnlockTts}
                          disabled={!ttsSupported}
                        >
                          {isTtsUnlocked ? "语音已启用" : "启用语音"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={handleTestTts}
                          disabled={!ttsSupported}
                        >
                          测试
                        </Button>
                      </div>
                    ) : null}
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
        <DialogContent className="sm:max-w-[380px] p-8">
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping opacity-75" />
              <Avatar className="w-24 h-24 border-4 border-background shadow-xl relative bg-background">
                <AvatarImage src={users.find(u => u.id === callPeer?.id)?.avatar} />
                <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                  {callPeer?.name?.slice(0, 1) || "?"}
                </AvatarFallback>
              </Avatar>
            </div>

            <div className="text-center space-y-2">
              <DialogTitle className="text-2xl font-semibold">{t("call.incomingTitle")}</DialogTitle>
              <DialogDescription className="text-base text-muted-foreground">
                {callPeer ? t("call.incomingDesc", { name: callPeer.name }) : ""}
              </DialogDescription>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 w-full mt-6">
            <Button
              variant="outline"
              onClick={handleRejectCall}
              className="h-14 rounded-full border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-all"
            >
              <PhoneOff className="w-5 h-5 mr-2" />
              {t("call.reject")}
            </Button>
            <Button
              onClick={handleAcceptCall}
              className="h-14 rounded-full shadow-lg shadow-primary/30 transition-all hover:scale-105 active:scale-95 text-base font-medium"
            >
              <Phone className="w-5 h-5 mr-2 fill-current" />
              {t("call.accept")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
