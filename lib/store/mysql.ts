import { getPrisma } from "@/lib/prisma"
import { RoomStore, RoomData, User, Message } from "./types"

export class MysqlRoomStore implements RoomStore {
  async joinRoom(roomId: string, user: User): Promise<RoomData> {
    const prisma = await getPrisma()
    await prisma.room.upsert({
      where: { id: roomId },
      create: {
        id: roomId,
        createdAt: new Date(),
        lastActivityAt: new Date(),
      },
      update: {
        lastActivityAt: new Date(),
      },
    })

    await prisma.roomUser.upsert({
      where: {
        roomId_userId: {
          roomId,
          userId: user.id,
        },
      },
      create: {
        roomId,
        userId: user.id,
        data: user,
      },
      update: {
        data: user,
      },
    })

    const room = await this.getRoom(roomId)
    if (!room) throw new Error("Failed to fetch room after joining")
    return room
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    const prisma = await getPrisma()
    await prisma.roomUser.delete({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    })
  }

  async sendMessage(roomId: string, message: Message): Promise<Message> {
    const prisma = await getPrisma()
    await prisma.roomMessage.create({
      data: {
        roomId,
        data: message,
        createdAt: new Date(),
      },
    })
    await prisma.room.update({
      where: { id: roomId },
      data: { lastActivityAt: new Date() },
    })
    return message
  }

  async getRoom(roomId: string): Promise<RoomData | null> {
    const prisma = await getPrisma()
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        users: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    })
    if (!room) return null

    const users = room.users
      .map((u) => u.data as User | null)
      .filter((u): u is User => Boolean(u))
    const messages = room.messages
      .map((m) => m.data as Message | null)
      .filter((m): m is Message => Boolean(m))

    return {
      id: roomId,
      users,
      messages,
      createdAt: room.createdAt.toISOString(),
    }
  }
}
