"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Users, ArrowRight, LogOut } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import { SettingsDialog } from "@/components/settings-dialog"

type RoomJoinProps = {
  onJoin: (roomId: string, userName: string) => void
}

export function RoomJoin({ onJoin }: RoomJoinProps) {
  const { profile, user, signOut, updateProfile } = useAuth()
  const { toast } = useToast()
  const [roomId, setRoomId] = useState("")
  const [userName, setUserName] = useState("")
  const hasEditedUserNameRef = useRef(false)

  useEffect(() => {
    if (hasEditedUserNameRef.current) return
    if (userName.trim()) return

    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("voicelink_display_name")
      if (typeof stored === "string" && stored.trim()) {
        setUserName(stored.trim())
        return
      }
    }

    const fallback = profile?.display_name || user?.user_metadata?.full_name || user?.email
    if (typeof fallback === "string" && fallback.trim()) {
      setUserName(fallback.trim())
    }
  }, [profile?.display_name, user?.email, user?.user_metadata, userName])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (roomId.trim() && userName.trim()) {
      const nextName = userName.trim()
      if (typeof window !== "undefined") {
        window.localStorage.setItem("voicelink_display_name", nextName)
      }
      if (user && nextName !== (profile?.display_name ?? "")) {
        void updateProfile({ display_name: nextName }).catch((error) => {
          toast({
            title: "昵称更新失败",
            description: error instanceof Error ? error.message : "请稍后重试",
            variant: "destructive",
          })
        })
      }
      onJoin(roomId.trim(), nextName)
    }
  }

  const handleQuickJoin = () => {
    const randomRoom = `room-${Math.random().toString(36).substring(2, 8)}`
<<<<<<< Updated upstream
    const randomName = `User${Math.floor(Math.random() * 1000)}`
    onJoin(randomRoom, randomName)
=======
    const nextName = userName.trim() || `用户${Math.floor(Math.random() * 1000)}`
    if (typeof window !== "undefined" && nextName) {
      window.localStorage.setItem("voicelink_display_name", nextName)
    }
    if (user && nextName && nextName !== (profile?.display_name ?? "")) {
      void updateProfile({ display_name: nextName }).catch(() => { })
    }
    onJoin(randomRoom, nextName)
>>>>>>> Stashed changes
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center relative">
          <div className="absolute right-4 top-4">
            <SettingsDialog />
          </div>
          <div className="w-16 h-16 rounded-2xl bg-primary mx-auto mb-4 flex items-center justify-center">
            <Users className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Join Voice Chat</CardTitle>
          <CardDescription>Connect with speakers from around the world</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="userName">Your Name</Label>
              <Input
                id="userName"
                placeholder="Enter your name"
                value={userName}
                onChange={(e) => {
                  hasEditedUserNameRef.current = true
                  setUserName(e.target.value)
                }}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="roomId">Room ID</Label>
              <Input
                id="roomId"
                placeholder="Enter room ID or create new"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">Share this ID with others to join the same conversation</p>
            </div>

            <Button type="submit" className="w-full gap-2" size="lg">
              Join Room
              <ArrowRight className="w-4 h-4" />
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button variant="outline" onClick={handleQuickJoin} className="w-full bg-transparent">
            Quick Join (Random Room)
          </Button>

          <Button
            variant="ghost"
            onClick={() => signOut()}
            className="w-full text-muted-foreground hover:text-destructive"
          >
            <LogOut className="w-4 h-4 mr-2" />
            退出登录
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
