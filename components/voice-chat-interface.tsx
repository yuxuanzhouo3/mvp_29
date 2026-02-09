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
  const peerConnRef = useRef<RTCPeerConnection | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const liveListenRef = useRef(false)
  const { speak, unlock: unlockTts, isSupported: ttsSupported, isUnlocked: isTtsUnlocked } = useTextToSpeech({
    rate: settings.speechRate,
    volume: settings.speechVolume,
  })
  const remoteCommittedTranslationRef = useRef("")
  const remoteSpokenTranslationRef = useRef("")
  const remoteLastSpokenTextRef = useRef("")
  const ttsUnlockedRef = useRef(false)
  const ttsUnlockingRef = useRef(false)
  const ttsUnlockPromptedRef = useRef(false)
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

  const randomId = useCallback((): string => {
    if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
      return window.crypto.randomUUID()
    }
    return `call-${Math.random().toString(36).substring(2, 11)}`
  }, [])

  const stopFallbackLive = useCallback(() => {
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

  const resetCallState = useCallback(() => {
    setCallStatus("idle")
    setCallPeer(null)
    setCallId(null)
    setIncomingCallOpen(false)
    setIsCallStreaming(false)
    setCallDurationSec(0)
    setIsCallMuted(false)
    setCallLiveEnabled(true)
    setLiveTranscript("")
    setLiveTranslation("")
    setLiveTranscriptLines([])
    setLiveTranslationLines([])
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
    setRemoteLiveTranslation("")
    setRemoteLiveSourceLanguage("")
    setRemoteLiveUserName("")
    remoteCommittedTranslationRef.current = ""
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
  }, [stopFallbackLive])

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

  const ensureLocalMicStream = useCallback(async () => {
    if (callStreamRef.current) return callStreamRef.current
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
        sampleSize: 16,
        // Chrome-specific constraints for enhanced voice isolation
        googEchoCancellation: true,
        googExperimentalEchoCancellation: true,
        googAutoGainControl: true,
        googExperimentalAutoGainControl: true,
        googNoiseSuppression: true,
        googExperimentalNoiseSuppression: true,
        googHighpassFilter: true,
        googAudioMirroring: false,
      } as MediaTrackConstraints
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    callStreamRef.current = stream
    return stream
  }, [])

  const sourceLanguageRef = useRef<string>(sourceLanguage.code)
  useEffect(() => {
    sourceLanguageRef.current = sourceLanguage.code
  }, [sourceLanguage.code])

  const [asrMode, setAsrMode] = useState<"off" | "http" | "websocket">("off")

  // Tencent Cloud Real-time ASR WebSocket Client
  const tencentWsRef = useRef<WebSocket | null>(null)
  const isConnectingWsRef = useRef(false)
  const audioBufferRef = useRef<Int16Array[]>([])
  const audioBufferLenRef = useRef(0)
  const sessionTranscriptRef = useRef<string>("")
  const lastVoiceIdRef = useRef<string>("")
  const lastReceivedTextRef = useRef<string>("")

  const connectTencentAsr = useCallback(async () => {
    if (tencentWsRef.current?.readyState === WebSocket.OPEN) {
      setAsrMode("websocket")
      return tencentWsRef.current
    }

    try {
      isConnectingWsRef.current = true
      // 1. Get signature from backend
      const res = await fetch("/api/transcribe/stream?action=get_signature", { method: "POST" })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || "Failed to get signature")
      }
      const { signature, secretid, timestamp, expired, nonce, engine_model_type, voice_id, voice_format, needvad, appid } = await res.json()

      // 2. Construct WebSocket URL
      const wsUrl = `wss://asr.cloud.tencent.com/asr/v2/${appid}?` +
        `secretid=${secretid}&` +
        `timestamp=${timestamp}&` +
        `expired=${expired}&` +
        `nonce=${nonce}&` +
        `engine_model_type=${engine_model_type}&` +
        `voice_id=${voice_id}&` +
        `voice_format=${voice_format}&` +
        `needvad=${needvad}&` +
        `vad_silence_time=3000&` +
        `signature=${encodeURIComponent(signature)}`

      const ws = new WebSocket(wsUrl)
      tencentWsRef.current = ws

      ws.onopen = () => {
        console.log("Tencent ASR WebSocket connected")
        setAsrMode("websocket")
        isConnectingWsRef.current = false
        toast({
          title: "实时语音连接成功",
          description: "已切换至腾讯云流式语音识别模式 (WebSocket)",
        })
        // 连接建立后，如果缓存有数据，立即发送（解决首字丢失）
        if (audioBufferLenRef.current > 0) {
          // 将缓存的数据分块发送，而不是一次性发送，避免数据包过大
          const CHUNK_SIZE = 12800 // 400ms (16k * 2 bytes * 0.4s)
          const totalLen = audioBufferLenRef.current
          const merged = new Int16Array(totalLen)
          let offset = 0
          for (const chunk of audioBufferRef.current) {
            merged.set(chunk, offset)
            offset += chunk.length
          }

          // 分块发送
          let sentBytes = 0
          const buffer = merged.buffer
          while (sentBytes < buffer.byteLength) {
            const end = Math.min(sentBytes + CHUNK_SIZE, buffer.byteLength)
            const chunk = buffer.slice(sentBytes, end)
            ws.send(chunk)
            sentBytes = end
          }

          audioBufferRef.current = []
          audioBufferLenRef.current = 0
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          if (data.code === 0 && data.result) {
            // data.result.voice_text_str contains the full text
            const text = data.result.voice_text_str
            const currentVoiceId = data.voice_id
            // Filter hallucinations
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
              if (!lastVoiceIdRef.current) {
                lastVoiceIdRef.current = currentVoiceId
              }

              if (lastVoiceIdRef.current !== currentVoiceId) {
                if (lastReceivedTextRef.current) {
                  const isCJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(lastReceivedTextRef.current)
                  sessionTranscriptRef.current += lastReceivedTextRef.current + (isCJK ? "" : " ")
                }
                lastVoiceIdRef.current = currentVoiceId
                lastReceivedTextRef.current = ""
              }

              lastReceivedTextRef.current = text
              setLiveTranscript(sessionTranscriptRef.current + text)
            }
          }
        } catch (e) {
          console.error("Tencent ASR message parse error", e)
        }
      }

      ws.onerror = (e) => {
        console.error("Tencent ASR WebSocket error", e)
        setAsrMode("http") // Fallback
        isConnectingWsRef.current = false
      }

      ws.onclose = () => {
        setAsrMode("http") // Fallback on close
        isConnectingWsRef.current = false
      }

      return ws
    } catch (e: any) {
      console.error("Failed to connect to Tencent ASR", e)
      setAsrMode("http")
      isConnectingWsRef.current = false
      toast({
        title: "实时语音连接失败",
        description: e.message || "无法连接到腾讯云 ASR，将降级使用 HTTP 模式",
        variant: "destructive",
      })
      return null
    }
  }, [toast])

  const startFallbackLive = useCallback(async () => {
    if (fallbackRecorderRef.current || fallbackProcessorRef.current) return
    try {
      void connectTencentAsr()

      let stream: MediaStream | null = callStatusRef.current === "active" ? callStreamRef.current : null
      let owned = false
      if (!stream) {
        const constraints = {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
            // Chrome-specific constraints
            googEchoCancellation: true,
            googExperimentalEchoCancellation: true,
            googAutoGainControl: true,
            googExperimentalAutoGainControl: true,
            googNoiseSuppression: true,
            googExperimentalNoiseSuppression: true,
            googHighpassFilter: true,
            googAudioMirroring: false,
          } as MediaTrackConstraints
        }
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        owned = true
      }
      fallbackStreamRef.current = stream
      fallbackStreamOwnedRef.current = owned

      const processQueue = async () => {
        if (fallbackProcessingRef.current) return
        if (!liveListenRef.current) {
          fallbackQueueRef.current = []
          return
        }
        const nextBlob = fallbackQueueRef.current.shift()
        if (!nextBlob) return
        fallbackProcessingRef.current = true
        try {
          // Add 5s timeout to prevent stuck requests
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 5000)

          // Use ref to get the latest language even if closure is stale
          // We wrap transcribeAudio to support abort signal if possible, or just race it
          const textPromise = transcribeAudio(nextBlob, sourceLanguageRef.current)
          const racePromise = new Promise<string>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error("Timeout")))
          })

          const text = await Promise.race([textPromise, racePromise])
          clearTimeout(timeoutId)

          // If fallback has been stopped (stream cleared), ignore result
          if (!fallbackStreamRef.current || !liveListenRef.current) return

          const normalized = text.trim()

          // Hallucination filter: ignore common repetitive patterns or known bad outputs from ASR/Whisper
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

          if (normalized && !isHallucination(normalized)) {
            const prev = fallbackLastTextRef.current
            let nextText = normalized
            if (prev) {
              if (normalized.startsWith(prev)) {
                nextText = normalized
              } else if (prev.startsWith(normalized)) {
                nextText = prev
              } else {
                const lang = sourceLanguageRef.current === "auto"
                  ? detectLanguageFromText(normalized)
                  : sourceLanguageRef.current
                const isCJK = lang.toLowerCase().startsWith("zh") ||
                  lang.toLowerCase().startsWith("ja") ||
                  lang.toLowerCase().startsWith("ko")
                const separator = isCJK ? "" : " "
                nextText = `${prev}${separator}${normalized}`.trim()
              }
            }
            const langForTrim = sourceLanguageRef.current === "auto"
              ? detectLanguageFromText(nextText)
              : sourceLanguageRef.current
            const isCJKForTrim = langForTrim.toLowerCase().startsWith("zh") ||
              langForTrim.toLowerCase().startsWith("ja") ||
              langForTrim.toLowerCase().startsWith("ko")
            if (nextText.length > 160) {
              const parts = (nextText.match(/[^。！？.!?]+[。！？.!?]+|[^。！？.!?]+$/g) ?? [])
                .map((s) => s.trim())
                .filter(Boolean)
              if (parts.length > 2) {
                const joiner = isCJKForTrim ? "" : " "
                nextText = parts.slice(-2).join(joiner).trim()
              }
            }
            fallbackLastTextRef.current = nextText
            setLiveTranscript(nextText)
          }
        } catch { }
        fallbackProcessingRef.current = false
        if (fallbackQueueRef.current.length > 0) {
          void processQueue()
        }
      }

      // Force use AudioContext + ScriptProcessor to ensure 16k WAV format
      // This avoids mobile browser compatibility issues (e.g. unsupported mimeTypes, wrong sample rates)
      // and ensures consistent behavior with Tencent ASR which prefers 16k WAV.
      /*
      if (typeof MediaRecorder !== "undefined") {
        const mimeTypeCandidates = isTencentDeploy
          ? ["audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm"]
          : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]
        const supportedMimeType = mimeTypeCandidates.find((candidate) =>
          MediaRecorder.isTypeSupported(candidate)
        )
        const mediaRecorder = supportedMimeType
          ? new MediaRecorder(stream, { mimeType: supportedMimeType })
          : new MediaRecorder(stream)
        fallbackRecorderRef.current = mediaRecorder
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            fallbackQueueRef.current.push(event.data)
            void processQueue()
          }
        }
        mediaRecorder.start(1200)
        setLiveSpeechSupported(true)
        return
      }
      */

      const AudioContextCtor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) {
        setLiveSpeechSupported(false)
        return
      }

      const audioContext = new AudioContextCtor()
      fallbackAudioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      const gainNode = audioContext.createGain()
      gainNode.gain.value = 0
      source.connect(processor)
      processor.connect(gainNode)
      gainNode.connect(audioContext.destination)
      fallbackProcessorRef.current = processor
      processor.onaudioprocess = (event) => {
        if (!liveListenRef.current) return
        const input = event.inputBuffer.getChannelData(0)

        // Resample to 16k for Tencent ASR / Backend
        const targetSampleRate = 16000
        const sourceSampleRate = event.inputBuffer.sampleRate
        const ratio = sourceSampleRate / targetSampleRate
        const newLength = Math.round(input.length / ratio)
        const pcmData = new Int16Array(newLength)

        for (let i = 0; i < newLength; i++) {
          const srcIdx = Math.floor(i * ratio)
          let val = input[srcIdx]
          if (srcIdx + 1 < input.length) {
            const frac = (i * ratio) - srcIdx
            val = val * (1 - frac) + input[srcIdx + 1] * frac
          }
          const s = Math.max(-1, Math.min(1, val))
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }

        // Check if we should use WebSocket (Open or Connecting)
        const ws = tencentWsRef.current
        // We use WebSocket if it exists and is not closed/closing OR if we are currently connecting (ws might be null)
        const useWs = isConnectingWsRef.current || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))

        if (useWs) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            // Send buffered data first if any
            if (audioBufferLenRef.current > 0) {
              const totalLen = audioBufferLenRef.current
              const merged = new Int16Array(totalLen)
              let offset = 0
              for (const chunk of audioBufferRef.current) {
                merged.set(chunk, offset)
                offset += chunk.length
              }
              ws.send(merged.buffer)
              audioBufferRef.current = []
              audioBufferLenRef.current = 0
            }
            // Send current chunk
            ws.send(pcmData.buffer)
          } else {
            // Buffer while connecting
            audioBufferRef.current.push(pcmData)
            audioBufferLenRef.current += pcmData.length
            // Buffer limit (approx 5 seconds)
            if (audioBufferLenRef.current > 80000) {
              const removeCount = audioBufferRef.current[0].length
              audioBufferRef.current.shift()
              audioBufferLenRef.current -= removeCount
            }
          }
        } else {
          // HTTP Fallback logic (Whisper or Tencent HTTP)
          fallbackBufferedChunksRef.current.push(new Float32Array(input))
          fallbackBufferedSamplesRef.current += input.length
          const sampleRate = event.inputBuffer.sampleRate
          const targetSeconds = 0.6
          const targetSamples = Math.floor(sampleRate * targetSeconds)
          if (fallbackBufferedSamplesRef.current >= targetSamples) {
            const total = fallbackBufferedSamplesRef.current
            const merged = new Float32Array(total)
            let offset = 0
            for (const chunk of fallbackBufferedChunksRef.current) {
              merged.set(chunk, offset)
              offset += chunk.length
            }
            fallbackBufferedChunksRef.current = []
            fallbackBufferedSamplesRef.current = 0

            let sumSq = 0
            for (let i = 0; i < merged.length; i++) {
              sumSq += merged[i] * merged[i]
            }
            const rms = Math.sqrt(sumSq / merged.length)
            const silenceThreshold = isMobile ? 0.005 : 0.02


            if (rms < silenceThreshold) return

            void (async () => {
              try {
                const resampled = await resampleTo16k(merged, sampleRate)
                const wavBuffer = encodeFloat32ToWav(resampled, 16000)
                fallbackQueueRef.current.push(new Blob([wavBuffer], { type: "audio/wav" }))
                void processQueue()
              } catch { }
            })()
          }
        }
      }
      setLiveSpeechSupported(true)
    } catch {
      setLiveSpeechSupported(false)
      toast({
        title: t("toast.errorTitle"),
        description: t("voice.micPermissionAlert"),
        variant: "destructive",
      })
      stopFallbackLive()
    }
  }, [encodeFloat32ToWav, isMobile, isTencentDeploy, resampleTo16k, sourceLanguage.code, stopFallbackLive, t, toast, transcribeAudio])



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
        iceServers: [
          // 小米 STUN
          { urls: "stun:stun.miwifi.com" },
          // 腾讯 STUN
          { urls: "stun:stun.qq.com" },
          // Bilibili STUN
          { urls: "stun:stun.chat.bilibili.com" },
          // Google STUN (Backup)
          { urls: "stun:stun.l.google.com:19302" }
        ],
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
          el.muted = settings.onlyHearTranslatedVoice
          if (!settings.onlyHearTranslatedVoice) {
            void el.play().catch(() => { })
          }
        } catch { }
      }
      if (typeof pc.addTransceiver === "function") {
        try {
          pc.addTransceiver("audio", { direction: settings.onlyHearTranslatedVoice ? "recvonly" : "sendrecv" })
        } catch { }
      }
      if (!settings.onlyHearTranslatedVoice) {
        const local = await ensureLocalMicStream()
        for (const track of local.getTracks()) {
          pc.addTrack(track, local)
        }
      } else {
        await ensureLocalMicStream()
      }
      peerConnRef.current = pc
      setIsCallStreaming(true)
      return pc
    },
    [ensureLocalMicStream, sendSignal, settings.onlyHearTranslatedVoice],
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

  const handleToggleCallLive = useCallback(() => {
    setCallLiveEnabled((prev) => {
      const next = !prev
      if (!next) {
        setLiveTranscript("")
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
      }
      return next
    })
  }, [roomUserId, sendSignal, sourceLanguage.code, t, targetLanguage.code, userName])

  const resolveLanguageCode = useCallback((value: string): string => {
    const byCode = SUPPORTED_LANGUAGES.find((l) => l.code === value)
    if (byCode) return byCode.code
    const byName = SUPPORTED_LANGUAGES.find((l) => l.name === value)
    if (byName) return byName.code
    return value
  }, [])

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
  }, [isInRoom, liveTranscript, primaryOf, sourceLanguage.code, targetLanguage.code])

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

  useEffect(() => {
    if (callStatus !== "active") return
    const transcript = remoteLiveTranscript.trim()
    if (!transcript) {
      setRemoteLiveTranslation("")
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

    if (remoteTranslateTimerRef.current) {
      clearTimeout(remoteTranslateTimerRef.current)
      remoteTranslateTimerRef.current = null
    }

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

    remoteTranslateTimerRef.current = setTimeout(() => {
      if (remoteTranslateAbortRef.current) remoteTranslateAbortRef.current.abort()
      const controller = new AbortController()
      remoteTranslateAbortRef.current = controller
      void translateText(transcript, sourceCode, targetCode, controller.signal)
        .then((translated) => {
          if (!controller.signal.aborted) setRemoteLiveTranslation(translated)
        })
        .catch(() => { })
        .finally(() => {
          if (remoteTranslateAbortRef.current === controller) remoteTranslateAbortRef.current = null
        })
    }, 150)

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
  }, [callStatus, detectLanguageFromText, primaryOf, remoteLiveSourceLanguage, remoteLiveTranscript, targetLanguage.code])

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
      if (!ttsUnlockPromptedRef.current) {
        ttsUnlockPromptedRef.current = true
        toast({
          title: "点击屏幕启用语音播放",
          description: "需要先点击页面，系统才允许播放语音。",
        })
      }
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
        if (ttsSupported && !ttsUnlockedRef.current) return
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
    window.addEventListener("pointerdown", tryUnlock, { passive: true })
    return () => window.removeEventListener("pointerdown", tryUnlock)
  }, [speak, ttsSupported, unlockTts])

  useEffect(() => {
    if (!isMobile || !settings.autoPlayTranslations) return
    if (ttsSupported) return
    if (ttsUnsupportedNotifiedRef.current) return
    ttsUnsupportedNotifiedRef.current = true
    toast({
      title: "当前浏览器不支持语音播放",
      description: "请使用系统浏览器或关闭静音模式后再试。",
      variant: "destructive",
    })
  }, [isMobile, settings.autoPlayTranslations, toast, ttsSupported])

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

  const handleTestTts = useCallback(() => {
    if (!ttsSupported) {
      toast({
        title: "当前浏览器不支持语音播放",
        description: "请使用系统浏览器或关闭静音模式后再试。",
        variant: "destructive",
      })
      return
    }
    if (!ttsUnlockedRef.current) {
      void handleUnlockTts()
      return
    }
    speak("语音测试", targetLanguage.code)
  }, [handleUnlockTts, speak, targetLanguage.code, toast, ttsSupported])

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
            if (type === "call_caption") {
              const incomingId = String(payload.callId || "")
              if (callStatusRef.current !== "active" || (incomingId && callIdRef.current && incomingId !== callIdRef.current)) {
                continue
              }
              const transcript = typeof payload.transcript === "string" ? payload.transcript : ""
              const translation = typeof payload.translation === "string" ? payload.translation : ""
              const sourceLang = typeof payload.sourceLanguage === "string" ? payload.sourceLanguage : ""

              setRemoteLiveTranscript(transcript)

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
              autoPlay={false}
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
                    {/* Local live translation hidden as per user request */}
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
                            <div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{remoteLiveTranscript}</div>
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
                          <div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{remoteLiveTranscript}</div>
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
