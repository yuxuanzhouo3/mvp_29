"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Header } from "@/components/header"
import { ChatArea } from "@/components/chat-area"
import { VoiceControls } from "@/components/voice-controls"
import { LanguageSelector } from "@/components/language-selector"
import { RoomJoin } from "@/components/room-join"
import { UserList, type User } from "@/components/user-list"
import { transcribeAudio, translateText } from "@/lib/audio-utils"
import { useToast } from "@/hooks/use-toast"
import type { AppSettings } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { LogOut, Copy, Check } from "lucide-react"

export type Language = {
  code: string
  name: string
  flag: string
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en-US", name: "English", flag: "🇺🇸" },
  { code: "zh-CN", name: "中文", flag: "🇨🇳" },
  { code: "ja-JP", name: "日本語", flag: "🇯🇵" },
  { code: "es-ES", name: "Español", flag: "🇪🇸" },
  { code: "fr-FR", name: "Français", flag: "🇫🇷" },
  { code: "de-DE", name: "Deutsch", flag: "🇩🇪" },
  { code: "ko-KR", name: "한국어", flag: "🇰🇷" },
  { code: "pt-BR", name: "Português", flag: "🇧🇷" },
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

export function VoiceChatInterface() {
  const [isInRoom, setIsInRoom] = useState(false)
  const [roomId, setRoomId] = useState("")
  const [userId] = useState(() => `user-${Math.random().toString(36).substring(2, 11)}`)
  const [userName, setUserName] = useState("")
  const [users, setUsers] = useState<User[]>([])
  const [copied, setCopied] = useState(false)

  const [messages, setMessages] = useState<Message[]>([])
  const [userLanguage, setUserLanguage] = useState<Language>(SUPPORTED_LANGUAGES[0])
  const [targetLanguage, setTargetLanguage] = useState<Language>(SUPPORTED_LANGUAGES[1])
  const [isProcessing, setIsProcessing] = useState(false)
  const [settings, setSettings] = useState<AppSettings>({
    darkMode: false,
    autoPlayTranslations: false,
    speechRate: 0.9,
    speechVolume: 1.0,
    saveHistory: true,
    platform: "web",
  })
  const { toast } = useToast()
  const pollIntervalRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (!isInRoom || !roomId) return

    const pollRoom = async () => {
      try {
        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", roomId }),
        })

        const data = await response.json()
        if (data.success && data.room) {
          setUsers(data.room.users)

          // Update messages with translations for current user
          const newMessages = await Promise.all(
            data.room.messages.map(async (msg: any) => {
              const isCurrentUser = msg.userId === userId
              let translatedText = msg.originalText

              // Translate message to current user's target language if not from current user
              if (!isCurrentUser && msg.originalLanguage !== targetLanguage.name) {
                try {
                  translatedText = await translateText(msg.originalText, msg.originalLanguage, targetLanguage.name)
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
                originalLanguage: msg.originalLanguage,
                targetLanguage: targetLanguage.name,
                timestamp: new Date(msg.timestamp),
                isUser: isCurrentUser,
                audioUrl: msg.audioUrl,
                userAvatar: users.find((u) => u.id === msg.userId)?.avatar,
              }
            }),
          )

          setMessages(newMessages)
        }
      } catch (error) {
        console.error("[v0] Poll error:", error)
      }
    }

    pollRoom()
    pollIntervalRef.current = setInterval(pollRoom, 2000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [isInRoom, roomId, userId, targetLanguage])

  const handleJoinRoom = async (newRoomId: string, newUserName: string) => {
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          roomId: newRoomId,
          userId,
          userName: newUserName,
          sourceLanguage: userLanguage.name,
          targetLanguage: targetLanguage.name,
        }),
      })

      const data = await response.json()
      if (data.success) {
        setRoomId(newRoomId)
        setUserName(newUserName)
        setIsInRoom(true)
        setUsers(data.room.users)
        toast({
          title: "Joined room",
          description: `Welcome to ${newRoomId}!`,
        })
      }
    } catch (error) {
      console.error("[v0] Join room error:", error)
      toast({
        title: "Error",
        description: "Failed to join room. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleLeaveRoom = async () => {
    try {
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "leave",
          roomId,
          userId,
        }),
      })

      setIsInRoom(false)
      setRoomId("")
      setMessages([])
      setUsers([])

      toast({
        title: "Left room",
        description: "You have disconnected from the chat.",
      })
    } catch (error) {
      console.error("[v0] Leave room error:", error)
    }
  }

  const handleCopyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: "Copied!",
        description: "Room ID copied to clipboard",
      })
    } catch (error) {
      console.error("[v0] Copy error:", error)
    }
  }

  const handleLanguageSwap = () => {
    setUserLanguage(targetLanguage)
    setTargetLanguage(userLanguage)
  }

  const handleClearChat = useCallback(() => {
    setMessages([])
    toast({
      title: "Chat cleared",
      description: "All messages have been removed.",
    })
  }, [toast])

  const handleRecordingComplete = useCallback(
    async (audioBlob: Blob) => {
      console.log("[v0] Recording complete, blob size:", audioBlob.size)
      setIsProcessing(true)

      try {
        const audioUrl = URL.createObjectURL(audioBlob)

        const transcribedText = await transcribeAudio(audioBlob, userLanguage.name)
        console.log("[v0] Transcribed text:", transcribedText)

        const message = {
          id: Date.now().toString(),
          userId,
          userName,
          originalText: transcribedText,
          originalLanguage: userLanguage.name,
          timestamp: new Date().toISOString(),
          audioUrl,
        }

        await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "message",
            roomId,
            message,
          }),
        })

        toast({
          title: "Message sent",
          description: `Broadcasting in ${userLanguage.name}`,
        })
      } catch (error) {
        console.error("[v0] Processing error:", error)
        toast({
          title: "Error",
          description: "Failed to process your voice. Please try again.",
          variant: "destructive",
        })
      } finally {
        setIsProcessing(false)
      }
    },
    [userLanguage, roomId, userId, userName, toast],
  )

  if (!isInRoom) {
    return <RoomJoin onJoin={handleJoinRoom} />
  }

  return (
    <div className="flex flex-col h-screen">
      <Header
        onClearChat={handleClearChat}
        messageCount={messages.length}
        onSettingsChange={setSettings}
        roomId={isInRoom ? roomId : undefined}
        userCount={users.length}
      />

      <div className="flex-1 flex max-w-7xl w-full mx-auto px-4 py-6 gap-6 overflow-hidden">
        <div className="hidden lg:block w-64 flex-shrink-0">
          <UserList users={users} currentUserId={userId} />
        </div>

        <div className="flex-1 flex flex-col gap-6 min-w-0">
          <div className="flex items-center justify-between gap-4 p-4 bg-card rounded-lg border border-border">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">Room ID</p>
              <p className="font-mono font-medium truncate">{roomId}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopyRoomId} className="gap-2 bg-transparent">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handleLeaveRoom} className="gap-2 bg-transparent">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Leave</span>
              </Button>
            </div>
          </div>

          <LanguageSelector
            userLanguage={userLanguage}
            targetLanguage={targetLanguage}
            onUserLanguageChange={setUserLanguage}
            onTargetLanguageChange={setTargetLanguage}
            onSwap={handleLanguageSwap}
          />

          <ChatArea
            messages={messages}
            speechRate={settings.speechRate}
            speechVolume={settings.speechVolume}
            autoPlay={settings.autoPlayTranslations}
          />

          <VoiceControls isProcessing={isProcessing} onRecordingComplete={handleRecordingComplete} />
        </div>
      </div>
    </div>
  )
}
