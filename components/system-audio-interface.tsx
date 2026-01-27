"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, MonitorPlay, Square, Loader2, AlertCircle } from "lucide-react"
import Link from "next/link"
import { transcribeAudio, translateText } from "@/lib/audio-utils"
import { SUPPORTED_LANGUAGES, type Language } from "@/components/voice-chat-interface"
import { useToast } from "@/hooks/use-toast"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type TranscriptItem = {
  id: string
  original: string
  translation: string
  timestamp: Date
}

export function SystemAudioInterface() {
  const [isRecording, setIsRecording] = useState(false)
  const [sourceLanguage, setSourceLanguage] = useState<Language>(
    SUPPORTED_LANGUAGES.find((l) => l.code === "en-US") || SUPPORTED_LANGUAGES[0]
  )
  const [targetLanguage, setTargetLanguage] = useState<Language>(
    SUPPORTED_LANGUAGES.find((l) => l.code === "zh-CN") || SUPPORTED_LANGUAGES[1]
  )
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const { toast } = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcripts])

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
    setIsRecording(false)
  }

  const startRecording = async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      // Check if audio track exists
      const audioTrack = displayStream.getAudioTracks()[0]
      if (!audioTrack) {
        toast({
          title: "未检测到系统音频",
          description: "请在分享屏幕时勾选'分享系统音频'或'分享标签页音频'",
          variant: "destructive",
        })
        displayStream.getTracks().forEach(t => t.stop())
        return
      }

      setStream(displayStream)
      
      // Stop if user clicks "Stop sharing" in browser UI
      displayStream.getVideoTracks()[0].onended = () => {
        stopRecording()
      }

      // Create MediaRecorder
      // Try to use a supported mime type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"
        
      const mediaRecorder = new MediaRecorder(displayStream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          await processAudioChunk(event.data)
        }
      }

      // Slice every 5 seconds
      mediaRecorder.start(5000)
      setIsRecording(true)
      
    } catch (error) {
      console.error("Error starting recording:", error)
      toast({
        title: "无法开始录音",
        description: "请确保您已授予屏幕录制权限，并勾选了分享音频。",
        variant: "destructive",
      })
    }
  }

  const processAudioChunk = async (audioBlob: Blob) => {
    try {
      // Transcribe
      const text = await transcribeAudio(audioBlob, sourceLanguage.code)
      if (!text || text.trim().length === 0) return

      // Translate
      const translation = await translateText(
        text,
        sourceLanguage.code,
        targetLanguage.code
      )

      setTranscripts((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          original: text,
          translation,
          timestamp: new Date(),
        },
      ])
    } catch (error) {
      console.error("Processing error:", error)
      // Silent fail for empty chunks or errors to keep flow smooth
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

      <main className="flex-1 flex flex-col p-4 max-w-4xl mx-auto w-full gap-4 overflow-hidden">
        <Card className="shrink-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>使用说明</AlertTitle>
              <AlertDescription>
                点击"开始监听"后，请选择包含音频的<strong>浏览器标签页</strong>或<strong>整个屏幕</strong>，并务必勾选<strong>"分享音频"</strong>。
              </AlertDescription>
            </Alert>
            
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex flex-col gap-2 min-w-[140px]">
                <span className="text-sm text-muted-foreground">源语言 (听)</span>
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
                <span className="text-sm text-muted-foreground">目标语言 (译)</span>
                <Select
                  value={targetLanguage.code}
                  onValueChange={(val) => {
                    const lang = SUPPORTED_LANGUAGES.find(l => l.code === val)
                    if (lang) setTargetLanguage(lang)
                  }}
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

              <Button
                size="lg"
                variant={isRecording ? "destructive" : "default"}
                onClick={isRecording ? stopRecording : startRecording}
                className="w-full sm:w-auto"
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
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
          </CardHeader>
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-6">
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
