"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Users, ArrowRight } from "lucide-react"

type RoomJoinProps = {
  onJoin: (roomId: string, userName: string) => void
}

export function RoomJoin({ onJoin }: RoomJoinProps) {
  const [roomId, setRoomId] = useState("")
  const [userName, setUserName] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (roomId.trim() && userName.trim()) {
      onJoin(roomId.trim(), userName.trim())
    }
  }

  const handleQuickJoin = () => {
    const randomRoom = `room-${Math.random().toString(36).substring(2, 8)}`
    const randomName = `User${Math.floor(Math.random() * 1000)}`
    onJoin(randomRoom, randomName)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
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
                onChange={(e) => setUserName(e.target.value)}
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
        </CardContent>
      </Card>
    </div>
  )
}
