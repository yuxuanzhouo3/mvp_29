"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import type { Message } from "@/components/voice-chat-interface"
import { Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import { useState, useEffect, useRef } from "react"

type ChatAreaProps = {
  messages: Message[]
  speechRate?: number
  speechVolume?: number
  autoPlay?: boolean
}

export function ChatArea({ messages, speechRate = 0.9, speechVolume = 1.0, autoPlay = false }: ChatAreaProps) {
  const { speak, stop, isSpeaking } = useTextToSpeech({ rate: speechRate, volume: speechVolume })
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const lastMessage = messages[messages.length - 1]
  const lastMessageId = lastMessage?.id
  const lastMessageIsUser = lastMessage?.isUser === true
<<<<<<< Updated upstream
<<<<<<< Updated upstream
=======
=======
>>>>>>> Stashed changes

  const getLanguageName = (value: string): string => {
    const byCode = SUPPORTED_LANGUAGES.find((l) => l.code === value)
    if (byCode) return byCode.name
    return value
  }

  const normalizeToLanguageCode = (value: string): string => {
    const byCode = SUPPORTED_LANGUAGES.find((l) => l.code === value)
    if (byCode) return byCode.code
    const byName = SUPPORTED_LANGUAGES.find((l) => l.name === value)
    if (byName) return byName.code
    return value
  }
>>>>>>> Stashed changes

  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return

    const update = () => {
      const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      shouldAutoScrollRef.current = distanceToBottom < 24
    }

    update()
    viewport.addEventListener("scroll", update, { passive: true })
    return () => viewport.removeEventListener("scroll", update)
  }, [])

  useEffect(() => {
    if (!shouldAutoScrollRef.current && !lastMessageIsUser) return

    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
  }, [messages])
=======
  }, [lastMessageId, lastMessageIsUser, liveCaption?.originalText, liveCaption?.translatedText])
>>>>>>> Stashed changes
=======
  }, [lastMessageId, lastMessageIsUser, liveCaption?.originalText, liveCaption?.translatedText])
>>>>>>> Stashed changes
=======
  }, [lastMessageId, lastMessageIsUser, liveCaption?.originalText, liveCaption?.translatedText])
>>>>>>> Stashed changes

  useEffect(() => {
    if (autoPlay && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.id !== lastMessageIdRef.current) {
        lastMessageIdRef.current = lastMessage.id
        const languageCode = getLanguageCode(lastMessage.targetLanguage)
        speak(lastMessage.translatedText, languageCode)
        setPlayingMessageId(`${lastMessage.id}-translated`)
      }
    }
  }, [messages, autoPlay, speak])

  const handlePlayOriginal = (message: Message) => {
    if (playingMessageId === `${message.id}-original` && isSpeaking) {
      stop()
      setPlayingMessageId(null)
    } else {
      stop()
      const languageCode = message.isUser ? message.originalLanguage : getLanguageCode(message.originalLanguage)
      speak(message.originalText, languageCode)
      setPlayingMessageId(`${message.id}-original`)
    }
  }

  const handlePlayTranslated = (message: Message) => {
    if (playingMessageId === `${message.id}-translated` && isSpeaking) {
      stop()
      setPlayingMessageId(null)
    } else {
      stop()
      const languageCode = getLanguageCode(message.targetLanguage)
      speak(message.translatedText, languageCode)
      setPlayingMessageId(`${message.id}-translated`)
    }
  }

  const getLanguageCode = (languageName: string): string => {
    const langMap: Record<string, string> = {
      English: "en-US",
      中文: "zh-CN",
      日本語: "ja-JP",
      Español: "es-ES",
      Français: "fr-FR",
      Deutsch: "de-DE",
      한국어: "ko-KR",
      Português: "pt-BR",
    }
    return langMap[languageName] || "en-US"
  }

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date)
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-card rounded-xl border border-border">
        <div className="text-center max-w-md px-4">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Volume2 className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Start Your Conversation</h2>
          <p className="text-muted-foreground leading-relaxed">
            Press and hold the microphone button to speak in your source language. Everyone in the room will hear your
            message translated to their target language in real-time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1 bg-card rounded-xl border border-border p-4" ref={scrollAreaRef}>
      <div className="space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
          >
            {!message.isUser && (
              <Avatar className="w-8 h-8 mr-2 mt-1">
                <AvatarImage src={message.userAvatar || "/placeholder.svg"} alt={message.userName} />
                <AvatarFallback>{message.userName[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
            )}

            <div
              className={`max-w-[70%] rounded-xl p-4 ${
                message.isUser ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
              }`}
            >
              {!message.isUser && <p className="text-xs font-semibold mb-2 opacity-70">{message.userName}</p>}

              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium opacity-80">{message.originalLanguage}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 -mt-1 hover:bg-background/20"
                  onClick={() => handlePlayOriginal(message)}
                >
                  {playingMessageId === `${message.id}-original` && isSpeaking ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <p className="text-base leading-relaxed mb-3">{message.originalText}</p>
              <div className="pt-3 border-t border-current/20">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium opacity-80">{message.targetLanguage}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-background/20"
                    onClick={() => handlePlayTranslated(message)}
                  >
                    {playingMessageId === `${message.id}-translated` && isSpeaking ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-base leading-relaxed">{message.translatedText}</p>
              </div>
              <div className="mt-2 text-xs opacity-60 text-right">{formatTime(message.timestamp)}</div>
            </div>

            {message.isUser && (
              <Avatar className="w-8 h-8 ml-2 mt-1">
                <AvatarImage src={message.userAvatar || "/placeholder.svg"} alt={message.userName} />
                <AvatarFallback>{message.userName[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  )
}
