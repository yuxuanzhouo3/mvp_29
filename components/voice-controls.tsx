"use client"

import { Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useAudioRecorder } from "@/hooks/use-audio-recorder"
import { useCallback, useEffect, useRef } from "react"
import { useI18n } from "@/components/i18n-provider"

type VoiceControlsProps = {
  isProcessing: boolean
  onRecordingComplete: (audioBlob: Blob) => void
  onRecordingChange?: (isRecording: boolean) => void
  variant?: "stacked" | "inline"
}

export function VoiceControls({
  isProcessing,
  onRecordingComplete,
  onRecordingChange,
  variant = "stacked",
}: VoiceControlsProps) {
  const { isRecording, recordingTime, audioBlob, startRecording, stopRecording } = useAudioRecorder()
  const { t } = useI18n()
  const isPressingRef = useRef(false)
  const shouldStopAfterStartRef = useRef(false)
  const onRecordingCompleteRef = useRef(onRecordingComplete)
  const lastHandledBlobRef = useRef<Blob | null>(null)
  const isInline = variant === "inline"

  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete
  }, [onRecordingComplete])

  useEffect(() => {
    if (audioBlob && !isRecording && audioBlob !== lastHandledBlobRef.current) {
      lastHandledBlobRef.current = audioBlob
      onRecordingCompleteRef.current(audioBlob)
    }
  }, [audioBlob, isRecording])

  useEffect(() => {
    onRecordingChange?.(isRecording)
  }, [isRecording, onRecordingChange])

  useEffect(() => {
    if (!isRecording) return

    const stop = () => stopRecording()

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") stop()
    }

    window.addEventListener("pointerup", stop, { passive: true })
    window.addEventListener("pointercancel", stop, { passive: true })
    window.addEventListener("blur", stop, { passive: true })
    document.addEventListener("visibilitychange", onVisibilityChange, { passive: true })

    return () => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [isRecording, stopRecording])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handlePressStart = useCallback(
    async (event: React.PointerEvent<HTMLButtonElement>) => {
      if (isProcessing || isRecording) return
      if (typeof event.button === "number" && event.button !== 0) return

      event.preventDefault()
      isPressingRef.current = true
      shouldStopAfterStartRef.current = false

      if (typeof event.currentTarget.setPointerCapture === "function") {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {}
      }

      try {
        await startRecording()
        if (!isPressingRef.current || shouldStopAfterStartRef.current) {
          stopRecording()
        }
      } catch (error) {
        console.error("[v0] Recording error:", error)
        isPressingRef.current = false
        shouldStopAfterStartRef.current = false
        alert(t("voice.micPermissionAlert"))
      }
    },
    [isProcessing, isRecording, startRecording, stopRecording, t],
  )

  const handlePressEnd = useCallback(
    (event?: React.PointerEvent<HTMLButtonElement>) => {
      event?.preventDefault()
      isPressingRef.current = false
      if (isRecording) stopRecording()
      else shouldStopAfterStartRef.current = true
    },
    [isRecording, stopRecording],
  )

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
  }, [])

  return (
    <div className={isInline ? "flex items-center gap-3" : "flex flex-col items-center gap-4 pb-6"}>
      <div className={isInline ? "flex-1 min-w-0" : ""}>
        {isProcessing && (
          <div className={isInline ? "flex items-center gap-2 text-muted-foreground" : "flex items-center gap-2 text-muted-foreground"}>
            <Spinner className="w-4 h-4" />
            <span className={isInline ? "text-sm" : "text-sm"}>{t("voice.processing")}</span>
          </div>
        )}

        {!isProcessing && isRecording && (
          <div className={isInline ? "flex items-center justify-between gap-3" : "flex flex-col items-center gap-2"}>
            <div className={isInline ? "flex items-center gap-2 text-destructive" : "flex items-center gap-2 text-destructive"}>
              <div className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm font-medium">{t("voice.recording")}</span>
            </div>
            <span className={isInline ? "text-base font-mono text-foreground" : "text-lg font-mono text-foreground"}>
              {formatTime(recordingTime)}
            </span>
          </div>
        )}

        {!isProcessing && !isRecording && (
          <p className={isInline ? "text-xs text-muted-foreground leading-relaxed" : "text-sm text-muted-foreground text-center max-w-xs"}>
            {t("voice.hintHold")}
          </p>
        )}
      </div>

      <Button
        size={isInline ? "default" : "lg"}
        className={`rounded-full transition-all ${
          isInline ? "w-14 h-14" : "w-20 h-20"
        } ${
          isRecording
            ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground scale-110"
            : "bg-primary hover:bg-primary/90 text-primary-foreground"
        }`}
        onPointerDown={handlePressStart}
        onPointerUp={handlePressEnd}
        onPointerCancel={handlePressEnd}
        onContextMenu={handleContextMenu}
        disabled={isProcessing}
      >
        {isRecording ? (
          <Square className={isInline ? "w-6 h-6" : "w-8 h-8"} fill="currentColor" />
        ) : (
          <Mic className={isInline ? "w-6 h-6" : "w-8 h-8"} />
        )}
      </Button>

      {!isInline && (
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          {isRecording ? t("voice.hintRelease") : t("voice.hintHold")}
        </p>
      )}
    </div>
  )
}
