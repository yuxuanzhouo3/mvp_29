"use client"

import { useState, useCallback, useEffect, useRef } from "react"

type TextToSpeechOptions = {
  rate?: number
  volume?: number
  preferDefaultVoice?: boolean
  immediate?: boolean
}

export function useTextToSpeech(options: TextToSpeechOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentUtterance, setCurrentUtterance] = useState<SpeechSynthesisUtterance | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const optionsRef = useRef(options)
  const unlockedRef = useRef(false)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const voicesReadyRef = useRef(false)
  const lastVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const speakAttemptRef = useRef(0)
  const isSupported = typeof window !== "undefined" && (typeof window.speechSynthesis !== "undefined" || (typeof window !== "undefined" && typeof (window as any).AndroidTTS !== "undefined"))

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const ensureVoices = useCallback(() => {
    if (!isSupported || typeof window === "undefined" || !window.speechSynthesis) {
      return Promise.resolve([] as SpeechSynthesisVoice[])
    }
    if (voicesReadyRef.current && voicesRef.current.length) {
      return Promise.resolve(voicesRef.current)
    }
    const existing = window.speechSynthesis.getVoices()
    if (existing.length) {
      voicesRef.current = existing
      voicesReadyRef.current = true
      return Promise.resolve(existing)
    }
    return new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let resolved = false
      const finish = (voices: SpeechSynthesisVoice[]) => {
        if (resolved) return
        resolved = true
        voicesRef.current = voices
        voicesReadyRef.current = voices.length > 0
        resolve(voices)
      }
      const handle = () => {
        if (!window.speechSynthesis) return
        const voices = window.speechSynthesis.getVoices()
        finish(voices)
      }
      window.speechSynthesis.addEventListener("voiceschanged", handle)
      setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", handle)
        const voices = window.speechSynthesis.getVoices()
        finish(voices)
      }, 1500)
    })
  }, [isSupported])

  useEffect(() => {
    if (!isSupported) return
    void ensureVoices()
  }, [ensureVoices, isSupported])

  const pickVoice = useCallback((voices: SpeechSynthesisVoice[], languageCode: string) => {
    if (!voices.length) return null
    const normalized = languageCode.toLowerCase()
    const exactMatches = voices.filter((voice) => voice.lang.toLowerCase() === normalized)
    if (exactMatches.length) {
      return exactMatches.find((voice) => voice.localService) || exactMatches[0]
    }
    const primary = normalized.split("-")[0]
    const primaryMatches = voices.filter((voice) => voice.lang.toLowerCase().startsWith(primary))
    if (primaryMatches.length) {
      return primaryMatches.find((voice) => voice.localService) || primaryMatches[0]
    }
    return voices.find((voice) => voice.localService) || (voices[0] ?? null)
  }, [])

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
        const utterance = new SpeechSynthesisUtterance("ok")
        utterance.lang = "en-US"
        utterance.volume = 0.05
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
        void ensureVoices().then(() => {
          window.speechSynthesis.speak(utterance)
        })
      } catch {
        resolve(false)
      }
    })
  }, [ensureVoices, isSupported])

  const doSpeak = useCallback((text: string, languageCode: string, overrides?: TextToSpeechOptions) => {
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

    const attemptId = ++speakAttemptRef.current
    let started = false
    const speakWithVoices = (voices: SpeechSynthesisVoice[]) => {
      // Fix for iOS: resume before speaking
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel()
      }

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

      const lang = langMap[languageCode] || languageCode || "en-US"
      const merged = { ...optionsRef.current, ...overrides }
      const useDefaultVoice = merged.preferDefaultVoice === true
      if (useDefaultVoice) {
        utterance.lang = lang
        lastVoiceRef.current = null
      } else {
        const selectedVoice = pickVoice(voices, lang)
        if (selectedVoice) {
          utterance.voice = selectedVoice
          utterance.lang = selectedVoice.lang
          lastVoiceRef.current = selectedVoice
        } else {
          utterance.lang = lang
          lastVoiceRef.current = null
        }
      }
      utterance.rate = merged.rate ?? 0.9
      utterance.pitch = 1.0
      utterance.volume = merged.volume ?? 1.0

      const handleStart = () => {
        console.log("[v0] Speech started")
        started = true
        setIsSpeaking(true)
        if (!unlockedRef.current) {
          unlockedRef.current = true
          setIsUnlocked(true)
        }
      }

      const handleEnd = () => {
        console.log("[v0] Speech ended")
        setIsSpeaking(false)
        setCurrentUtterance(null)
      }

      const handleError = (event: SpeechSynthesisErrorEvent) => {
        console.error("[v0] Speech error:", event)
        setIsSpeaking(false)
        setCurrentUtterance(null)
      }

      utterance.onstart = handleStart
      utterance.onend = handleEnd
      utterance.onerror = handleError

      setCurrentUtterance(utterance)
      window.speechSynthesis.speak(utterance)

      setTimeout(() => {
        if (speakAttemptRef.current !== attemptId) return
        if (started) return
        console.warn("[v0] TTS timeout, trying fallback")
        window.speechSynthesis.cancel()
        
        // Fallback to Server Proxy TTS (Bypasses CORS/Referer issues)
          const playOnlineTTS = () => {
            try {
               const proxyUrl = `/api/tts?text=${encodeURIComponent(text)}&lang=${lang}`
               console.log("[v0] Using Proxy TTS fallback:", proxyUrl)
               
               const audio = new Audio(proxyUrl)
               audio.volume = merged.volume ?? 1.0
               
               audio.onplay = () => {
                 handleStart()
               }
               audio.onended = () => {
                 handleEnd()
               }
               audio.onerror = (e) => {
                 console.error("[v0] Proxy TTS error:", e)
                 // Mock event to avoid TypeError
                 const mockEvent = { 
                   error: "network", 
                   target: audio,
                   type: "error"
                 } as unknown as SpeechSynthesisErrorEvent
                 handleError(mockEvent)
               }
               
               audio.play().catch(e => {
                 console.error("[v0] Proxy TTS play failed:", e)
               })

            } catch (e) {
              console.error("[v0] Proxy TTS setup failed:", e)
            }
          }

        // Try SpeechSynthesis one last time with default voice, if that fails immediately or timeouts, usage of online tts would be better?
        // Actually, since SpeechSynthesis is proving unreliable, let's try Online TTS directly as fallback.
        // But to be safe, let's try the default voice logic BUT with a very short timeout, then Online TTS.
        // Or simpler: Just go to Online TTS.
        
        playOnlineTTS()
        
      }, 500)
    }

    const merged = { ...optionsRef.current, ...overrides }
    if (merged.immediate) {
      const voices = window.speechSynthesis.getVoices()
      speakWithVoices(voices)
      return
    }

    void ensureVoices().then((voices) => {
      speakWithVoices(voices)
    })
  }, [ensureVoices, pickVoice])

  const speak = useCallback((text: string, languageCode: string) => {
    doSpeak(text, languageCode)
  }, [doSpeak])

  const speakWithOptions = useCallback((text: string, languageCode: string, overrides?: TextToSpeechOptions) => {
    doSpeak(text, languageCode, overrides)
  }, [doSpeak])

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

  const getVoices = useCallback(() => ensureVoices(), [ensureVoices])
  const getLastVoice = useCallback(() => lastVoiceRef.current, [])

  return {
    speak,
    speakWithOptions,
    stop,
    pause,
    resume,
    isSpeaking,
    isSupported,
    unlock,
    isUnlocked,
    getVoices,
    getLastVoice,
  }
}
