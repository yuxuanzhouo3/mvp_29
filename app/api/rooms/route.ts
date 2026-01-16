import { type NextRequest, NextResponse } from "next/server"
<<<<<<< Updated upstream

// In-memory storage for rooms (in production, use a database)
const rooms = new Map<
  string,
  {
    id: string
    users: Map<
      string,
      {
        id: string
        name: string
        sourceLanguage: string
        targetLanguage: string
        avatar: string
      }
    >
    messages: Array<{
      id: string
      userId: string
      userName: string
      originalText: string
      originalLanguage: string
      timestamp: string
      audioUrl?: string
    }>
  }
>()
=======
import { getRoomStore } from "@/lib/store"
>>>>>>> Stashed changes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, roomId, userId, userName, sourceLanguage, targetLanguage, message, avatarUrl } = body
    const store = getRoomStore()

    if (action === "join") {
<<<<<<< Updated upstream
      // Join or create room
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          users: new Map(),
          messages: [],
        })
      }

      const room = rooms.get(roomId)!
      const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`

      room.users.set(userId, {
=======
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 })
      }
      if (typeof userName !== "string" || userName.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userName" }, { status: 400 })
      }
      if (typeof sourceLanguage !== "string" || sourceLanguage.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid sourceLanguage" }, { status: 400 })
      }
      if (typeof targetLanguage !== "string" || targetLanguage.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid targetLanguage" }, { status: 400 })
      }

      const avatar =
        typeof avatarUrl === "string" && avatarUrl.trim().length > 0
          ? avatarUrl.trim()
          : `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`
      const user = {
>>>>>>> Stashed changes
        id: userId,
        name: userName,
        sourceLanguage,
        targetLanguage,
        avatar,
      }

      const roomData = await store.joinRoom(roomId, user)

      return NextResponse.json({
        success: true,
        room: roomData,
      })
    }

    if (action === "leave") {
<<<<<<< Updated upstream
      // Leave room
      const room = rooms.get(roomId)
      if (room) {
        room.users.delete(userId)
        if (room.users.size === 0) {
          rooms.delete(roomId)
        }
      }
=======
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 })
      }

      await store.leaveRoom(roomId, userId)
>>>>>>> Stashed changes
      return NextResponse.json({ success: true })
    }

    if (action === "message") {
<<<<<<< Updated upstream
      // Add message to room
      const room = rooms.get(roomId)
      if (!room) {
        return NextResponse.json({ success: false, error: "Room not found" }, { status: 404 })
      }

      room.messages.push(message)
=======
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }

      if (typeof message !== "object" || message === null) {
        return NextResponse.json({ success: false, error: "Invalid message" }, { status: 400 })
      }

      const savedMessage = await store.sendMessage(roomId, message)
>>>>>>> Stashed changes

      return NextResponse.json({
        success: true,
        message: savedMessage,
      })
    }

    if (action === "poll") {
<<<<<<< Updated upstream
      // Poll for updates
      const room = rooms.get(roomId)
      if (!room) {
=======
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }

      const roomData = await store.getRoom(roomId)
      if (!roomData) {
>>>>>>> Stashed changes
        return NextResponse.json({ success: false, error: "Room not found" }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        room: roomData,
      })
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[v0] Room API error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
