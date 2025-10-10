"use client"

import { useState, useCallback, useRef } from "react"

type TextToSpeechOptions = {
  rate?: number
  volume?: number
}

export function useTextToSpeech(options: TextToSpeechOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentUtterance, setCurrentUtterance] = useState<SpeechSynthesisUtterance | null>(null)
  const optionsRef = useRef(options)

  optionsRef.current = options

  const speak = useCallback((text: string, languageCode: string) => {
    if (!window.speechSynthesis) {
      console.error("[v0] Speech synthesis not supported")
      return
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)

    const langMap: Record<string, string> = {
      "en-US": "en-US",
      "zh-CN": "zh-CN",
      "ja-JP": "ja-JP",
      "es-ES": "es-ES",
      "fr-FR": "fr-FR",
      "de-DE": "de-DE",
      "ko-KR": "ko-KR",
      "pt-BR": "pt-BR",
    }

    utterance.lang = langMap[languageCode] || "en-US"
    utterance.rate = optionsRef.current.rate ?? 0.9
    utterance.pitch = 1.0
    utterance.volume = optionsRef.current.volume ?? 1.0

    utterance.onstart = () => {
      console.log("[v0] Speech started")
      setIsSpeaking(true)
    }

    utterance.onend = () => {
      console.log("[v0] Speech ended")
      setIsSpeaking(false)
      setCurrentUtterance(null)
    }

    utterance.onerror = (event) => {
      console.error("[v0] Speech error:", event)
      setIsSpeaking(false)
      setCurrentUtterance(null)
    }

    setCurrentUtterance(utterance)
    window.speechSynthesis.speak(utterance)
  }, [])

  const stop = useCallback(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      setCurrentUtterance(null)
    }
  }, [])

  const pause = useCallback(() => {
    if (window.speechSynthesis && isSpeaking) {
      window.speechSynthesis.pause()
    }
  }, [isSpeaking])

  const resume = useCallback(() => {
    if (window.speechSynthesis && currentUtterance) {
      window.speechSynthesis.resume()
    }
  }, [currentUtterance])

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
  }
}
