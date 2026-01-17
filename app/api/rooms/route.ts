import { type NextRequest, NextResponse } from "next/server"

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, roomId, userId, userName, sourceLanguage, targetLanguage, message } = body

    if (action === "join") {
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
        id: userId,
        name: userName,
        sourceLanguage,
        targetLanguage,
        avatar,
      })

      return NextResponse.json({
        success: true,
        room: {
          id: room.id,
          users: Array.from(room.users.values()),
          messages: room.messages,
        },
      })
    }

    if (action === "leave") {
      // Leave room
      const room = rooms.get(roomId)
      if (room) {
        room.users.delete(userId)
        if (room.users.size === 0) {
          rooms.delete(roomId)
        }
      }
      return NextResponse.json({ success: true })
    }

    if (action === "message") {
      // Add message to room
      const room = rooms.get(roomId)
      if (!room) {
        return NextResponse.json({ success: false, error: "Room not found" }, { status: 404 })
      }

      room.messages.push(message)

      return NextResponse.json({
        success: true,
        message,
      })
    }

    if (action === "poll") {
      // Poll for updates
      const room = rooms.get(roomId)
      if (!room) {
        return NextResponse.json({ success: false, error: "Room not found" }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        room: {
          id: room.id,
          users: Array.from(room.users.values()),
          messages: room.messages,
        },
      })
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[v0] Room API error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
