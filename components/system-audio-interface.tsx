"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, MonitorPlay, Square, Loader2, AlertCircle, ChevronDown, ChevronUp, Settings2 } from "lucide-react"
import Link from "next/link"
import { transcribeAudio, translateText, encodeFloat32ToWav, encodeFloat32ToPcm16le, resampleTo16k } from "@/lib/audio-utils"
import { SUPPORTED_LANGUAGES, type Language } from "@/components/voice-chat-interface"
import { useToast } from "@/hooks/use-toast"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

type TranscriptItem = {
  id: string
  original: string
  translation: string
  timestamp: Date
}

const HALLUCINATION_PHRASES = [
  "Thank you.", "Oh.", "Ah.", "Bye.", "Subtitle by", "Translated by",
  "Amara.org", "Unbelievable.", "Okay.", "Yeah.", "Shh.", "You.", ".", ".."
]

export function SystemAudioInterface() {
  const isTencentDeploy =
    typeof process !== "undefined" &&
    String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
      .trim()
      .toLowerCase() === "tencent"
  const minAudioBytes = 1024
  const silenceThreshold = 0.01
  const PAUSE_THRESHOLD = 600
  const MAX_BUFFER_DURATION = 6000
  const TARGET_SEGMENT_DURATION = 3500
  const MIN_SPEECH_DURATION = 300

  const [isRecording, setIsRecording] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(true)
  const [debugAsrText, setDebugAsrText] = useState("")
  const [debugRealtimePartial, setDebugRealtimePartial] = useState("")
  const [debugQueueCount, setDebugQueueCount] = useState(0)
  const [debugLastEnqueueAt, setDebugLastEnqueueAt] = useState<number | null>(null)
  const [debugLastChunkBytes, setDebugLastChunkBytes] = useState(0)
  const [debugLastChunkAt, setDebugLastChunkAt] = useState<number | null>(null)
  const [debugRms, setDebugRms] = useState(0)
  const [debugIsSpeaking, setDebugIsSpeaking] = useState(false)
  const [debugMimeType, setDebugMimeType] = useState("")
  // 新增：API 调试状态
  const [debugApiStatus, setDebugApiStatus] = useState<string>("-")
  const [debugApiResponse, setDebugApiResponse] = useState<string>("-")
  const [debugWavSize, setDebugWavSize] = useState<string>("-")
  const [debugError, setDebugError] = useState<string>("")
  const [sourceLanguage, setSourceLanguage] = useState<Language>(
    SUPPORTED_LANGUAGES.find((l) => l.code === "en-US") || SUPPORTED_LANGUAGES[0]
  )
  const [targetLanguage, setTargetLanguage] = useState<Language>(
    SUPPORTED_LANGUAGES.find((l) => l.code === "zh-CN") || SUPPORTED_LANGUAGES[1]
  )
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const realtimeWsRef = useRef<WebSocket | null>(null)
  const realtimeReadyRef = useRef(false)
  const realtimeConnectingRef = useRef(false)
  const realtimeQueueRef = useRef<ArrayBuffer[]>([])
  const realtimePartialRef = useRef("")
  const realtimeSendRawRef = useRef(false)
  const realtimeEnabledRef = useRef(false)
  const lastSpeakingTimeRef = useRef<number>(0)
  const speechStartTimeRef = useRef<number>(0)
  const { toast } = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const activeSourceRef = useRef<Language>(
    SUPPORTED_LANGUAGES.find((l) => l.code === "en-US") || SUPPORTED_LANGUAGES[0]
  )
  const activeTargetRef = useRef<Language>(
    SUPPORTED_LANGUAGES.find((l) => l.code === "zh-CN") || SUPPORTED_LANGUAGES[1]
  )
  const chunkQueueRef = useRef<Array<{ text: string; timestamp: number }>>([])
  const processingRef = useRef(false)
  const translateAbortRef = useRef<AbortController | null>(null)
  const shortBufferRef = useRef("")
  const shortBufferTimestampRef = useRef<number | null>(null)
  const audioBufferRef = useRef<Float32Array[]>([])
  const bufferStartTimeRef = useRef<number>(0)
  const noAudioTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasAudioDetectedRef = useRef(false)
  const noAudioToastShownRef = useRef(false)
  const lastRmsUpdateRef = useRef(0)
  const committedPrefixRef = useRef("")

  const resolveTencentEngine = (language: Language): string => {
    const code = language.code.toLowerCase()
    if (code.startsWith("zh")) return "16k_zh"
    if (code.startsWith("en")) return "16k_en"
    if (code.startsWith("ja")) return "16k_ja"
    if (code.startsWith("ko")) return "16k_ko"
    if (code.startsWith("fr")) return "16k_fr"
    if (code.startsWith("de")) return "16k_de"
    if (code.startsWith("es")) return "16k_es"
    if (code.startsWith("pt")) return "16k_pt"
    return "16k_zh"
  }

  const resolveTencentVoiceFormat = (mimeType: string): number => {
    const normalized = String(mimeType || "").toLowerCase()
    if (normalized.includes("wav")) return 12
    if (normalized.includes("mp3") || normalized.includes("mpeg")) return 8
    if (normalized.includes("m4a") || normalized.includes("mp4")) return 14
    if (normalized.includes("aac")) return 16
    if (normalized.includes("opus")) return 10
    if (normalized.includes("ogg") || normalized.includes("webm")) return 10
    return 10
  }

  const enqueueTranscript = async (text: string, capturedAt: number) => {
    const cleaned = text.trim()
    if (!cleaned) return

    if (HALLUCINATION_PHRASES.some((phrase) => cleaned.toLowerCase() === phrase.toLowerCase())) {
      return
    }
    if (/^[.!?。！？,，\s]+$/.test(cleaned)) {
      return
    }
    if (/^(\W)\1+$/.test(cleaned)) {
      return
    }

    const wordCount = cleaned.split(/\s+/).filter(Boolean).length
    const isVeryShort = cleaned.length <= 3 || wordCount <= 1
    const endsWithPunctuation = /[.!?。！？]$/.test(cleaned)

    if (isVeryShort && !endsWithPunctuation) {
      shortBufferRef.current = shortBufferRef.current
        ? `${shortBufferRef.current} ${cleaned}`
        : cleaned
      if (!shortBufferTimestampRef.current) {
        shortBufferTimestampRef.current = capturedAt
      }
      return
    }
    const merged = shortBufferRef.current
      ? `${shortBufferRef.current} ${cleaned}`.trim()
      : cleaned
    const mergedTimestamp = shortBufferTimestampRef.current ?? capturedAt
    shortBufferRef.current = ""
    shortBufferTimestampRef.current = null
    while (chunkQueueRef.current.length > 4) {
      chunkQueueRef.current.shift()
    }
    if (processingRef.current && translateAbortRef.current) {
      translateAbortRef.current.abort()
    }
    chunkQueueRef.current.push({ text: merged, timestamp: mergedTimestamp })
    setDebugAsrText(merged)
    setDebugQueueCount(chunkQueueRef.current.length)
    setDebugLastEnqueueAt(Date.now())
    void flushQueue()
  }

  const closeRealtimeSocket = () => {
    const ws = realtimeWsRef.current
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ end: 1 }))
      }
      ws.close()
    }
    realtimeWsRef.current = null
    realtimeReadyRef.current = false
    realtimeEnabledRef.current = false
    realtimeSendRawRef.current = false
    realtimeQueueRef.current = []
    realtimePartialRef.current = ""
  }

  const openRealtimeSocket = async (voiceFormat: number, engineModelType: string) => {
    if (realtimeConnectingRef.current) return
    realtimeConnectingRef.current = true
    try {
      const params = new URLSearchParams({
        engineModelType,
        voiceFormat: String(voiceFormat),
        needVad: "1",
      })
      const response = await fetch(`/api/asr/realtime?${params.toString()}`)
      if (!response.ok) {
        throw new Error("实时识别初始化失败")
      }
      const data = (await response.json().catch(() => null)) as { url?: string } | null
      const url = data?.url
      if (!url) {
        throw new Error("实时识别初始化失败")
      }
      const ws = new WebSocket(url)
      ws.binaryType = "arraybuffer"
      ws.onopen = () => {
        realtimeReadyRef.current = true
        if (realtimeQueueRef.current.length > 0) {
          for (const chunk of realtimeQueueRef.current) {
            ws.send(chunk)
          }
          realtimeQueueRef.current = []
        }
      }
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>
          if (typeof payload.code === "number" && payload.code !== 0) {
            const message = typeof payload.message === "string" ? payload.message : "实时识别失败"
            toast({
              title: "实时识别异常",
              description: message,
              variant: "destructive",
            })
            closeRealtimeSocket()
            return
          }
          const result = payload.result as Record<string, unknown> | undefined
          const text =
            typeof result?.voice_text_str === "string"
              ? String(result.voice_text_str)
              : typeof payload.voice_text_str === "string"
                ? String(payload.voice_text_str)
                : ""
          const sliceType = Number(result?.slice_type ?? payload.slice_type ?? -1)
          const isFinal = sliceType === 2 || Number(result?.final ?? payload.final ?? 0) === 1
          const now = Date.now()
          if (text.trim().length > 0) {
            // Calculate effective text by removing already committed prefix
            let effectiveText = ""
            if (text.startsWith(committedPrefixRef.current)) {
               effectiveText = text.slice(committedPrefixRef.current.length)
            } else if (committedPrefixRef.current.startsWith(text)) {
               // ASR retracted text we already committed; ignore this update
               effectiveText = ""
            } else {
               // Divergence detected (ASR changed history significantly)
               // Reset prefix to start fresh from this point to avoid data loss, 
               // though this may cause some duplication in transcript
               committedPrefixRef.current = ""
               effectiveText = text
            }

            if (isFinal) {
              realtimePartialRef.current = ""
              setDebugRealtimePartial("")
              committedPrefixRef.current = ""
              if (effectiveText.trim()) {
                void enqueueTranscript(effectiveText, now)
              }
            } else {
              // Proactive segmentation based on punctuation
              // Look for sentence terminators followed by space or end of string
              const match = effectiveText.match(/([.!?。！？]+)(\s|$)/)
              if (match && match.index !== undefined && match.index + match[1].length < effectiveText.length) {
                 // Found a split point
                 const splitIndex = match.index + match[1].length
                 const toCommit = effectiveText.substring(0, splitIndex)
                 const remainder = effectiveText.substring(splitIndex)
                 
                 if (toCommit.trim()) {
                   void enqueueTranscript(toCommit, now)
                   committedPrefixRef.current += toCommit
                 }
                 
                 realtimePartialRef.current = remainder
                 setDebugRealtimePartial(remainder)
              } else {
                 realtimePartialRef.current = effectiveText
                 setDebugRealtimePartial(effectiveText)
              }
            }
          }
        } catch {
        }
      }
      ws.onerror = () => {
        toast({
          title: "实时识别异常",
          description: "连接已断开，请重试。",
          variant: "destructive",
        })
        closeRealtimeSocket()
      }
      ws.onclose = () => {
        realtimeReadyRef.current = false
      }
      realtimeWsRef.current = ws
    } finally {
      realtimeConnectingRef.current = false
    }
  }

  const sendRealtimeChunk = async (audioData: Blob | Float32Array) => {
    let buffer: ArrayBuffer

    if (audioData instanceof Blob) {
      if (audioData.size < minAudioBytes) return false
      buffer = await audioData.arrayBuffer()
    } else {
      // It's Float32Array
      // Check byte length approx (length * 2 for 16-bit PCM)
      if (audioData.length * 2 < minAudioBytes) return false
      
      // Resample to 16k if needed
      const currentRate = audioContextRef.current?.sampleRate || 48000
      let processedData = audioData
      
      if (currentRate !== 16000) {
         processedData = await resampleTo16k(audioData, currentRate)
      }
      
      buffer = encodeFloat32ToPcm16le(processedData)
    }

    const ws = realtimeWsRef.current
    if (!ws) {
      realtimeEnabledRef.current = false
      return false
    }
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(buffer)
      return true
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      realtimeQueueRef.current.push(buffer)
      return true
    }
    realtimeEnabledRef.current = false
    return false
  }

  const getScrollViewport = () => {
    const root = scrollRef.current
    if (!root) return null
    return root.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null
  }

  useEffect(() => {
    const viewport = getScrollViewport()
    if (!viewport || !autoScrollRef.current) return
    viewport.scrollTop = viewport.scrollHeight
  }, [transcripts])

  useEffect(() => {
    const viewport = getScrollViewport()
    if (!viewport) return
    const handleScroll = () => {
      const threshold = 32
      const atBottom =
        viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - threshold
      autoScrollRef.current = atBottom
    }
    handleScroll()
    viewport.addEventListener("scroll", handleScroll)
    return () => {
      viewport.removeEventListener("scroll", handleScroll)
    }
  }, [])

  useEffect(() => {
    if (!isRecording) {
      activeSourceRef.current = sourceLanguage
      activeTargetRef.current = targetLanguage
    }
  }, [isRecording, sourceLanguage, targetLanguage])

  const stopRecording = () => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect()
      scriptProcessorRef.current = null
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
    if (noAudioTimeoutRef.current) {
      clearTimeout(noAudioTimeoutRef.current)
      noAudioTimeoutRef.current = null
    }
    hasAudioDetectedRef.current = false
    noAudioToastShownRef.current = false
    closeRealtimeSocket()
    setDebugAsrText("")
    setDebugRealtimePartial("")
    setDebugQueueCount(0)
    setDebugLastEnqueueAt(null)
    setDebugLastChunkBytes(0)
    setDebugLastChunkAt(null)
    setDebugRms(0)
    setDebugIsSpeaking(false)
    setDebugMimeType("")
    committedPrefixRef.current = ""
    if (chunkQueueRef.current.length > 0) {
      void flushQueue()
    }
    if (audioBufferRef.current.length > 0) {
      // Process remaining audio buffer
      const totalLength = audioBufferRef.current.reduce((acc, cur) => acc + cur.length, 0)
      const merged = new Float32Array(totalLength)
      let offset = 0
      for (const arr of audioBufferRef.current) {
        merged.set(arr, offset)
        offset += arr.length
      }
      
      const sampleRate = audioContextRef.current?.sampleRate || 48000
      
      // Resample to 16k if needed (async in stopRecording context is OK but we need to handle it properly)
      // Since stopRecording is synchronous, we can't await easily here without making it async.
      // However, we can fire-and-forget the processing or make the button handler async.
      // For now, let's wrap in an async IIFE
      void (async () => {
         const resampled = await resampleTo16k(merged, sampleRate)
         const wavBuffer = encodeFloat32ToWav(resampled, 16000)
         const blob = new Blob([wavBuffer], { type: "audio/wav" })
         const capturedAt = bufferStartTimeRef.current || Date.now()
         await processAudioChunk(blob, capturedAt)
      })()
      
      audioBufferRef.current = []
    }
    setIsRecording(false)
    setIsSettingsOpen(true)
  }

  const startRecording = async () => {
    try {
      activeSourceRef.current = sourceLanguage
      activeTargetRef.current = targetLanguage
      hasAudioDetectedRef.current = false
      noAudioToastShownRef.current = false
      if (noAudioTimeoutRef.current) {
        clearTimeout(noAudioTimeoutRef.current)
        noAudioTimeoutRef.current = null
      }
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
        toast({
          title: "当前浏览器不支持系统音频录制",
          description: "请使用支持的浏览器（建议 Chrome/Edge）并重试。",
          variant: "destructive",
        })
        return
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      const audioTrack = displayStream.getAudioTracks()[0]
      if (!audioTrack) {
        toast({
          title: "未检测到系统音频",
          description: "请在分享屏幕时勾选'分享系统音频'或'分享标签页音频'",
          variant: "destructive",
        })
        displayStream.getTracks().forEach((track) => track.stop())
        return
      }

      setStream(displayStream)

      // Setup Audio Context without forcing sample rate
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]))
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      
      const sampleRate = audioContext.sampleRate
      console.log(`[SystemAudio] AudioContext initialized at ${sampleRate}Hz`)

      noAudioTimeoutRef.current = setTimeout(() => {
        if (!scriptProcessorRef.current) return
        if (hasAudioDetectedRef.current) return
        if (noAudioToastShownRef.current) return
        noAudioToastShownRef.current = true
        toast({
          title: "未检测到系统音频",
          description: "请确认分享了标签页音频或系统音频，并提高播放音量。",
          variant: "destructive",
        })
      }, 6000)

      // Start volume check loop
      const checkVolume = () => {
        if (!analyserRef.current) return
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteTimeDomainData(dataArray)

        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          const x = (dataArray[i] - 128) / 128
          sum += x * x
        }
        const rms = Math.sqrt(sum / dataArray.length)
        const now = Date.now()
        if (now - lastRmsUpdateRef.current > 500) {
          lastRmsUpdateRef.current = now
          setDebugRms(Number(rms.toFixed(4)))
        }

        if (rms > silenceThreshold) {
          hasAudioDetectedRef.current = true
          if (lastSpeakingTimeRef.current === 0) {
            speechStartTimeRef.current = Date.now()
          }
          lastSpeakingTimeRef.current = Date.now()
        } else {
          if (Date.now() - lastSpeakingTimeRef.current > PAUSE_THRESHOLD) {
            // Reset start time if silence is long enough
            speechStartTimeRef.current = 0
          }
        }

        if (audioContext.state === 'running') {
          requestAnimationFrame(checkVolume)
        }
      }
      checkVolume()

      const videoTrack = displayStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.onended = () => {
          stopRecording()
        }
      }
      audioTrack.onended = () => {
        stopRecording()
      }

      // Initialize ScriptProcessor for PCM capture
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      scriptProcessorRef.current = processor

      // Prevent audio feedback (echo) by connecting to a zero-gain node
      const gain = audioContext.createGain()
      gain.gain.value = 0
      processor.connect(gain)
      gain.connect(audioContext.destination)
      source.connect(processor)

      // Setup Realtime if needed
      if (isTencentDeploy) {
        realtimeSendRawRef.current = true // Always raw PCM
        realtimeEnabledRef.current = true
        const engineModelType = resolveTencentEngine(activeSourceRef.current)
        await openRealtimeSocket(1, engineModelType) // 1 = PCM
      }

      processor.onaudioprocess = async (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        // Copy data immediately because the buffer is reused
        const chunk = new Float32Array(inputData)

        const now = Date.now()
        const byteSize = chunk.length * 2 // 16-bit PCM size approximation for debug
        setDebugLastChunkBytes(byteSize)
        setDebugLastChunkAt(now)
        setDebugMimeType("audio/wav (pcm)")

        const timeSinceLastSpeech = now - lastSpeakingTimeRef.current
        const isSpeaking = timeSinceLastSpeech < PAUSE_THRESHOLD
        setDebugIsSpeaking(isSpeaking)

        // Calculate total speech duration in current session
        const speechDuration = lastSpeakingTimeRef.current - speechStartTimeRef.current

        // Realtime Sending
        if (isTencentDeploy && realtimeEnabledRef.current) {
          const handled = await sendRealtimeChunk(chunk)

          // Silence Detection & Auto-Flush for Realtime
          // If silence detected for > 1000ms and we have partial text, flush it
          if (!isSpeaking && timeSinceLastSpeech > 1000 && realtimePartialRef.current) {
             const text = realtimePartialRef.current.trim()
             if (text) {
               void enqueueTranscript(text, now)
               committedPrefixRef.current += realtimePartialRef.current // Use original with whitespace
               realtimePartialRef.current = ""
               setDebugRealtimePartial("")
             }
          }

          if (handled) return
        }

        // Buffer Logic
        if (isTencentDeploy && !realtimeEnabledRef.current) {
          if (audioBufferRef.current.length === 0) {
            bufferStartTimeRef.current = now
          }
          audioBufferRef.current.push(chunk)

          const sampleRate = audioContextRef.current?.sampleRate || 48000
          const currentDurationMs = (audioBufferRef.current.reduce((acc, c) => acc + c.length, 0) / sampleRate) * 1000

          if (currentDurationMs >= TARGET_SEGMENT_DURATION) {
            const totalLength = audioBufferRef.current.reduce((acc, cur) => acc + cur.length, 0)
            const merged = new Float32Array(totalLength)
            let offset = 0
            for (const arr of audioBufferRef.current) {
              merged.set(arr, offset)
              offset += arr.length
            }
            
            const capturedAt = bufferStartTimeRef.current || now
            // Copy buffer ref and clear immediately to avoid race conditions
            // But we need to keep the logic simple.
            // We'll process this chunk async
            
            // Clear buffer immediately for next segment
            audioBufferRef.current = []
            bufferStartTimeRef.current = now
            
            void (async () => {
              const resampled = await resampleTo16k(merged, sampleRate)
              const wavBuffer = encodeFloat32ToWav(resampled, 16000)
              const blob = new Blob([wavBuffer], { type: "audio/wav" })
              await processAudioChunk(blob, capturedAt)
            })()
          }
          return
        }

        if (isSpeaking) {
          if (audioBufferRef.current.length === 0) {
            bufferStartTimeRef.current = now
          }
          audioBufferRef.current.push(chunk)

          const currentDurationMs = (audioBufferRef.current.reduce((acc, c) => acc + c.length, 0) / 16000) * 1000

          if (currentDurationMs > TARGET_SEGMENT_DURATION) {
            const totalLength = audioBufferRef.current.reduce((acc, cur) => acc + cur.length, 0)
            const merged = new Float32Array(totalLength)
            let offset = 0
            for (const arr of audioBufferRef.current) {
              merged.set(arr, offset)
              offset += arr.length
            }
            const wavBuffer = encodeFloat32ToWav(merged, 16000)
            const blob = new Blob([wavBuffer], { type: "audio/wav" })

            const capturedAt = bufferStartTimeRef.current || now
            audioBufferRef.current = []
            bufferStartTimeRef.current = now
            await processAudioChunk(blob, capturedAt)
          } else if (currentDurationMs > MAX_BUFFER_DURATION) {
            // Force flush if too long
            const totalLength = audioBufferRef.current.reduce((acc, cur) => acc + cur.length, 0)
            const merged = new Float32Array(totalLength)
            let offset = 0
            for (const arr of audioBufferRef.current) {
              merged.set(arr, offset)
              offset += arr.length
            }
            const wavBuffer = encodeFloat32ToWav(merged, 16000)
            const blob = new Blob([wavBuffer], { type: "audio/wav" })

            const capturedAt = bufferStartTimeRef.current || now
            audioBufferRef.current = []
            bufferStartTimeRef.current = now
            await processAudioChunk(blob, capturedAt)
          }
        } else {
          // Silence detected
          if (audioBufferRef.current.length > 0) {
            if (speechDuration > MIN_SPEECH_DURATION) {
              const totalLength = audioBufferRef.current.reduce((acc, cur) => acc + cur.length, 0)
              const merged = new Float32Array(totalLength)
              let offset = 0
              for (const arr of audioBufferRef.current) {
                merged.set(arr, offset)
                offset += arr.length
              }
              const wavBuffer = encodeFloat32ToWav(merged, 16000)
              const blob = new Blob([wavBuffer], { type: "audio/wav" })

              const capturedAt = bufferStartTimeRef.current || now
              audioBufferRef.current = []
              await processAudioChunk(blob, capturedAt)
            } else {
              audioBufferRef.current = []
            }
          }
        }
      }

      setIsRecording(true)
      setIsSettingsOpen(false)
    } catch (error) {
      console.error("Error starting recording:", error)
      const message =
        error instanceof DOMException && error.name === "NotSupportedError"
          ? "系统音频录制不受支持，请使用支持的浏览器并选择分享标签页音频。"
          : "请确保您已授予屏幕录制权限，并勾选了分享音频。"
      toast({
        title: "无法开始录音",
        description: message,
        variant: "destructive",
      })
    }
  }

  const flushQueue = async () => {
    if (processingRef.current) return
    processingRef.current = true
    try {
      const sourceCode = activeSourceRef.current.code
      const targetCode = activeTargetRef.current.code
      while (chunkQueueRef.current.length > 1) {
        chunkQueueRef.current.shift()
      }
      while (chunkQueueRef.current.length > 0) {
        const item = chunkQueueRef.current.shift()
        const text = item?.text ?? ""
        const cleaned = text.trim()
        if (!cleaned) continue
        if (translateAbortRef.current) {
          translateAbortRef.current.abort()
        }
        const controller = new AbortController()
        translateAbortRef.current = controller
        let translation = ""
        try {
          translation = await translateText(cleaned, sourceCode, targetCode, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) {
            continue
          }
          throw error
        } finally {
          if (translateAbortRef.current === controller) {
            translateAbortRef.current = null
          }
        }
        setTranscripts((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            original: cleaned,
            translation,
            timestamp: new Date(item?.timestamp ?? Date.now()),
          },
        ])
      }
    } catch (error) {
      console.error("Processing error:", error)
    } finally {
      processingRef.current = false
      setDebugQueueCount(chunkQueueRef.current.length)
    }
  }

  const processAudioChunk = async (audioBlob: Blob, capturedAt: number) => {
    try {
      if (audioBlob.size < minAudioBytes) return

      // VAD logic already handled in ondataavailable, so we trust this blob contains valid speech

      const sourceCode = activeSourceRef.current.code

      // 更新调试信息：WAV 转换前
      setDebugApiStatus("发送中...")
      setDebugError("")

      const startTime = Date.now()
      // Transcribe
      // 强制转 WAV 逻辑在 audio-utils 内部处理，这里我们监控结果
      const text = await transcribeAudio(audioBlob, sourceCode)
      const duration = Date.now() - startTime
      
      // 更新调试信息：API 响应
      const timestamp = new Date().toLocaleTimeString()
      setDebugApiStatus(`200 OK (${timestamp}, ${duration}ms)`)
      setDebugApiResponse(text ? (text.length > 20 ? text.substring(0, 20) + "..." : text) : "[空结果]")
      setDebugWavSize(`${(audioBlob.size / 1024).toFixed(1)}KB (原始)`)

      if (!text || text.trim().length === 0) {
        console.log("ASR result is empty, skipping translate.")
        return
      }
      setDebugRealtimePartial("")
      setDebugAsrText(text) // 更新最新识别文本
      await enqueueTranscript(text, capturedAt)
    } catch (error: any) {
      console.error("Processing error:", error)
      setDebugApiStatus("Error")
      setDebugError(error.message || "Unknown error")
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center p-4 border-b bg-card">
        <Link href="/">
          <Button variant="ghost" size="icon" className="mr-4">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold flex-1">系统同声传译</h1>
      </header>

      <main className="flex-1 flex flex-col p-4 max-w-4xl mx-auto w-full gap-3 overflow-hidden">
        <Collapsible
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          className="w-full space-y-2"
        >
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              设置与控制
            </h2>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-9 p-0">
                {isSettingsOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                <span className="sr-only">Toggle</span>
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            <Card className="shrink-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">录制配置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Alert className="text-xs">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-xs">使用说明</AlertTitle>
                  <AlertDescription className="text-xs leading-relaxed">
                    点击"开始监听"后，请选择包含音频的<strong>浏览器标签页</strong>或<strong>整个屏幕</strong>，并务必勾选<strong>"分享音频"</strong>。
                  </AlertDescription>
                </Alert>

                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex flex-col gap-2 min-w-[140px]">
                    <span className="text-xs text-muted-foreground">源语言 (听)</span>
                    <Select
                      value={sourceLanguage.code}
                      onValueChange={(val) => {
                        const lang = SUPPORTED_LANGUAGES.find(l => l.code === val)
                        if (lang) setSourceLanguage(lang)
                      }}
                      disabled={isRecording}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            {lang.flag} {lang.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2 min-w-[140px]">
                    <span className="text-xs text-muted-foreground">目标语言 (译)</span>
                    <Select
                      value={targetLanguage.code}
                      onValueChange={(val) => {
                        const lang = SUPPORTED_LANGUAGES.find(l => l.code === val)
                        if (lang) setTargetLanguage(lang)
                      }}
                      disabled={isRecording}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            {lang.flag} {lang.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1" />
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* Floating control bar when settings collapsed */}
        {!isSettingsOpen && (
          <div className="flex items-center justify-between bg-card p-3 rounded-lg border shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-medium">{sourceLanguage.flag} {sourceLanguage.name}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium">{targetLanguage.flag} {targetLanguage.name}</span>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={stopRecording}
            >
              <Square className="w-3 h-3 mr-2 fill-current" />
              停止监听
            </Button>
          </div>
        )}

        {/* Start button outside when settings are open (for better UX flow) */}
        {isSettingsOpen && (
          <Button
            size="lg"
            variant={isRecording ? "destructive" : "default"}
            onClick={isRecording ? stopRecording : startRecording}
            className="w-full"
          >
            {isRecording ? (
              <>
                <Square className="w-4 h-4 mr-2 fill-current" />
                停止监听
              </>
            ) : (
              <>
                <MonitorPlay className="w-4 h-4 mr-2" />
                开始监听
              </>
            )}
          </Button>
        )}

        <Card className="flex-[2] flex flex-col min-h-0 overflow-hidden mt-2">
          <CardHeader className="pb-2 border-b">
            <CardTitle className="flex items-center justify-between">
              <span>实时字幕</span>
              {isRecording && (
                <span className="flex items-center text-sm font-normal text-red-500 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-red-500 mr-2" />
                  正在监听系统音频...
                </span>
              )}
            </CardTitle>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>识别中：{debugRealtimePartial || "—"}</span>
                <span>入队：{debugQueueCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>最新识别：{debugAsrText || "—"}</span>
                <span>
                  最近入队：{debugLastEnqueueAt ? new Date(debugLastEnqueueAt).toLocaleTimeString() : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>音量RMS：{debugRms || "—"}</span>
                <span>说话中：{debugIsSpeaking ? "是" : "否"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  分片大小：{debugLastChunkBytes ? `${Math.round(debugLastChunkBytes / 1024)}KB` : "—"}
                </span>
                <span>分片时间：{debugLastChunkAt ? new Date(debugLastChunkAt).toLocaleTimeString() : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Mime：{debugMimeType || "—"}</span>
                <span />
              </div>
              {/* 新增详细调试区 */}
              <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
                <div className="flex items-center justify-between text-orange-600">
                  <span>API状态: {debugApiStatus}</span>
                  <span>WAV原始: {debugWavSize}</span>
                </div>
                <div className="flex items-center justify-between text-orange-600">
                  <span>响应: {debugApiResponse}</span>
                </div>
                {debugError && (
                  <div className="text-red-500 font-bold mt-1">
                    错误: {debugError}
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
            <div className="space-y-6 p-4">
              {transcripts.length === 0 && (
                <div className="text-center text-muted-foreground py-10">
                  {isRecording ? "正在等待音频..." : "点击开始监听以获取实时字幕"}
                </div>
              )}
              {transcripts.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2">
                  <div className="text-sm text-muted-foreground">
                    {item.timestamp.toLocaleTimeString()}
                  </div>
                  <div className="text-lg font-medium">{item.original}</div>
                  <div className="text-lg text-primary">{item.translation}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </main>
    </div>
  )
}
