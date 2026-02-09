"use client"

import { useState, useCallback, useRef } from "react"

type TextToSpeechOptions = {
  rate?: number
  volume?: number
}

export function useTextToSpeech(options: TextToSpeechOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentUtterance, setCurrentUtterance] = useState<SpeechSynthesisUtterance | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const optionsRef = useRef(options)
  const unlockedRef = useRef(false)
  const isSupported = typeof window !== "undefined" && (typeof window.speechSynthesis !== "undefined" || (typeof window !== "undefined" && typeof (window as any).AndroidTTS !== "undefined"))

  optionsRef.current = options

  const unlock = useCallback(() => {
    if (!isSupported) return Promise.resolve(false)
    if (unlockedRef.current) return Promise.resolve(true)

    // If AndroidTTS is available, we consider it always unlocked or not needing unlock
    if (typeof window !== "undefined" && (window as any).AndroidTTS) {
      console.log("[useTextToSpeech] AndroidTTS detected in unlock");
      unlockedRef.current = true
      setIsUnlocked(true)
      return Promise.resolve(true)
    } else {
      console.log("[useTextToSpeech] AndroidTTS NOT detected in unlock");
    }

    return new Promise<boolean>((resolve) => {
      try {
        // Fix for iOS: resume before speaking
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume()
        }
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(" ")
        utterance.lang = "en-US"
        // Some browsers ignore silence/low volume, but 0.01 is usually safe
        utterance.volume = 0.01
        const timer = setTimeout(() => resolve(false), 2000)
        utterance.onstart = () => {
          clearTimeout(timer)
          unlockedRef.current = true
          setIsUnlocked(true)
          resolve(true)
          window.speechSynthesis.cancel()
        }
        utterance.onerror = () => {
          clearTimeout(timer)
          resolve(false)
        }
        window.speechSynthesis.speak(utterance)
      } catch {
        resolve(false)
      }
    })
  }, [isSupported])

  const speak = useCallback((text: string, languageCode: string) => {
    console.log("[useTextToSpeech] speak called", text, languageCode);
    // Check for AndroidTTS first
    if (typeof window !== "undefined" && (window as any).AndroidTTS) {
      console.log("[useTextToSpeech] Using AndroidTTS");
      try {
        (window as any).AndroidTTS.speak(text, languageCode)
        setIsSpeaking(true)
        // Estimate duration: ~10 chars per second + 1s buffer
        const duration = Math.max(1000, (text.length / 10) * 1000)
        setTimeout(() => setIsSpeaking(false), duration)
        return
      } catch (e) {
        console.error("AndroidTTS failed:", e)
      }
    }

    if (!window.speechSynthesis) {
      console.error("[v0] Speech synthesis not supported")
      return
    }

    // Fix for iOS: resume before speaking
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
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
      // If we successfully started speaking, we are unlocked
      if (!unlockedRef.current) {
        unlockedRef.current = true
        setIsUnlocked(true)
      }
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
    isSupported,
    unlock,
    isUnlocked,
  }
}
