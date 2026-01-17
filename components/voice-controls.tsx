"use client"

import { Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useAudioRecorder } from "@/hooks/use-audio-recorder"
import { useEffect } from "react"

type VoiceControlsProps = {
  isProcessing: boolean
  onRecordingComplete: (audioBlob: Blob) => void
}

export function VoiceControls({ isProcessing, onRecordingComplete }: VoiceControlsProps) {
  const { isRecording, recordingTime, audioBlob, startRecording, stopRecording } = useAudioRecorder()

  useEffect(() => {
    if (audioBlob && !isRecording) {
      onRecordingComplete(audioBlob)
    }
  }, [audioBlob, isRecording, onRecordingComplete])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleMouseDown = async () => {
    try {
      await startRecording()
    } catch (error) {
      console.error("[v0] Recording error:", error)
      alert("Failed to start recording. Please check microphone permissions.")
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 pb-6">
      {isProcessing && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="w-4 h-4" />
          <span className="text-sm">Transcribing and translating...</span>
        </div>
      )}

      {isRecording && !isProcessing && (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-destructive">
            <div className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium">Recording in source language...</span>
          </div>
          <span className="text-lg font-mono text-foreground">{formatTime(recordingTime)}</span>
        </div>
      )}

      <Button
        size="lg"
        className={`w-20 h-20 rounded-full transition-all ${
          isRecording
            ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground scale-110"
            : "bg-primary hover:bg-primary/90 text-primary-foreground"
        }`}
        onMouseDown={handleMouseDown}
        onMouseUp={stopRecording}
        onTouchStart={handleMouseDown}
        onTouchEnd={stopRecording}
        disabled={isProcessing}
      >
        {isRecording ? <Square className="w-8 h-8" fill="currentColor" /> : <Mic className="w-8 h-8" />}
      </Button>

      <p className="text-sm text-muted-foreground text-center max-w-xs">
        {isRecording ? "Release to translate to target language" : "Press and hold to speak in source language"}
      </p>
    </div>
  )
}
