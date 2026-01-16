import { RoomStore, RoomData, User, Message } from "./types"

type MemoryRoomData = {
  id: string
  users: Map<string, User>
  messages: Message[]
}

// Global storage to survive hot reloads in development
const globalForRooms = globalThis as unknown as { __voicelinkRooms?: Map<string, MemoryRoomData> }
if (!globalForRooms.__voicelinkRooms) {
  globalForRooms.__voicelinkRooms = new Map()
}
const rooms = globalForRooms.__voicelinkRooms!

export class MemoryRoomStore implements RoomStore {
  async joinRoom(roomId: string, user: User): Promise<RoomData> {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        users: new Map(),
        messages: [],
      })
    }

    const room = rooms.get(roomId)!
    room.users.set(user.id, user)

    return {
      id: room.id,
      users: Array.from(room.users.values()),
      messages: room.messages,
    }
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    const room = rooms.get(roomId)
    if (room) {
      room.users.delete(userId)
      if (room.users.size === 0) {
        rooms.delete(roomId)
      }
    }
  }

  async sendMessage(roomId: string, message: Message): Promise<Message> {
    const room = rooms.get(roomId)
    if (!room) {
      throw new Error("Room not found")
    }
    room.messages.push(message)
    return message
  }

  async getRoom(roomId: string): Promise<RoomData | null> {
    const room = rooms.get(roomId)
    if (!room) return null

    return {
      id: room.id,
      users: Array.from(room.users.values()),
      messages: room.messages,
    }
  }
}
