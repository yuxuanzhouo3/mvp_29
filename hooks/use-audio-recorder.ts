"use client"

import { useState, useRef, useCallback } from "react"

export type AudioRecorderState = {
  isRecording: boolean
  isPaused: boolean
  recordingTime: number
  audioBlob: Blob | null
  audioUrl: string | null
}

export function useAudioRecorder() {
  const isTencentDeploy =
    typeof process !== "undefined" &&
    String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
      .trim()
      .toLowerCase() === "tencent"
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    isPaused: false,
    recordingTime: 0,
    audioBlob: null,
    audioUrl: null,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
          googEchoCancellation: true,
          googExperimentalEchoCancellation: true,
          googAutoGainControl: true,
          googExperimentalAutoGainControl: true,
          googNoiseSuppression: true,
          googExperimentalNoiseSuppression: true,
          googHighpassFilter: true,
        } as MediaTrackConstraints,
      })
      streamRef.current = stream

      const mimeTypeCandidates = isTencentDeploy
        ? ["audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm"]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]
      const supportedMimeType = mimeTypeCandidates.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate)
      )
      const mediaRecorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        const audioUrl = URL.createObjectURL(audioBlob)

        setState((prev) => ({
          ...prev,
          audioBlob,
          audioUrl,
          isRecording: false,
        }))

        // Clean up
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }
      }

      mediaRecorder.start()

      // Start timer
      timerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          recordingTime: prev.recordingTime + 1,
        }))
      }, 1000)

      setState((prev) => ({
        ...prev,
        isRecording: true,
        recordingTime: 0,
        audioBlob: null,
        audioUrl: null,
      }))
    } catch (error) {
      console.error("[v0] Error starting recording:", error)
      throw new Error("Failed to access microphone. Please check your permissions.")
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause()
      setState((prev) => ({ ...prev, isPaused: true }))

      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume()
      setState((prev) => ({ ...prev, isPaused: false }))

      timerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          recordingTime: prev.recordingTime + 1,
        }))
      }, 1000)
    }
  }, [])

  const clearRecording = useCallback(() => {
    if (state.audioUrl) {
      URL.revokeObjectURL(state.audioUrl)
    }

    setState({
      isRecording: false,
      isPaused: false,
      recordingTime: 0,
      audioBlob: null,
      audioUrl: null,
    })

    audioChunksRef.current = []
  }, [state.audioUrl])

  return {
    ...state,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    clearRecording,
  }
}
