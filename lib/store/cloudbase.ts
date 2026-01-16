import tcb from "@cloudbase/node-sdk"
import { RoomStore, RoomData, User, Message } from "./types"

type CloudBaseDoc = { data: unknown }
type CloudBaseGetResult = { data: CloudBaseDoc[] }
type CloudBaseDocRef = {
  set(payload: Record<string, unknown>): Promise<unknown>
  remove(): Promise<unknown>
}
type CloudBaseQuery = {
  limit(n: number): CloudBaseQuery
  orderBy(field: string, direction: "asc" | "desc"): CloudBaseQuery
  get(): Promise<CloudBaseGetResult>
}
type CloudBaseCollection = {
  doc(id: string): CloudBaseDocRef
  add(payload: Record<string, unknown>): Promise<unknown>
  where(query: Record<string, unknown>): CloudBaseQuery
}
type CloudBaseDb = { collection(name: string): CloudBaseCollection }
type CloudBaseApp = { database(): CloudBaseDb }

export class CloudBaseRoomStore implements RoomStore {
  private db: CloudBaseDb
  private app: CloudBaseApp

  constructor() {
    const envId = process.env.TENCENT_ENV_ID
    const secretId = process.env.TENCENT_SECRET_ID
    const secretKey = process.env.TENCENT_SECRET_KEY
    
    // Initialize CloudBase
    // If running in CloudBase environment (container/function), credentials might be auto-injected
    // But providing them explicitly if available is safer for hybrid setup
    const config: Record<string, unknown> = { env: envId }
    if (secretId && secretKey) {
      config.secretId = secretId
      config.secretKey = secretKey
    }

    this.app = tcb.init(config) as unknown as CloudBaseApp
    this.db = this.app.database()
  }

  async joinRoom(roomId: string, user: User): Promise<RoomData> {
    // 1. Ensure room exists
    // Use set to create or update
    try {
      await this.db.collection("rooms").doc(roomId).set({
        updatedAt: new Date(),
      })
    } catch (e) {
      console.error("CloudBase room set error (ignorable):", e)
    }

    // 2. Upsert user
    // Construct a unique ID for the document to allow upsert behavior via set
    const userDocId = `${roomId}_${user.id}`
    await this.db.collection("room_users").doc(userDocId).set({
      room_id: roomId,
      user_id: user.id,
      data: user,
      updatedAt: new Date(),
    })

    const room = await this.getRoom(roomId)
    if (!room) throw new Error("Failed to fetch room after joining")
    return room
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    const userDocId = `${roomId}_${userId}`
    await this.db.collection("room_users").doc(userDocId).remove()
  }

  async sendMessage(roomId: string, message: Message): Promise<Message> {
    await this.db.collection("room_messages").add({
      room_id: roomId,
      data: message,
      created_at: new Date(),
    })
    return message
  }

  async getRoom(roomId: string): Promise<RoomData | null> {
    try {
        // Fetch users
      const usersRes = await this.db.collection("room_users").where({ room_id: roomId }).limit(100).get()
            
        // Fetch messages
      const messagesRes = await this.db
        .collection("room_messages")
        .where({ room_id: roomId })
        .orderBy("created_at", "asc")
        .limit(500)
        .get()

      const users = usersRes.data.map((doc) => doc.data as User)
      const messages = messagesRes.data.map((doc) => doc.data as Message)

      return {
        id: roomId,
        users,
        messages,
      }
    } catch (error) {
      console.error("CloudBase getRoom error:", error)
      return null
    }
  }
}
