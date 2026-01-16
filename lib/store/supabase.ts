import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { RoomStore, RoomData, User, Message } from "./types"

export class SupabaseRoomStore implements RoomStore {
  private supabase: SupabaseClient

  private async touchRoomActivity(roomId: string, atIso: string): Promise<void> {
    const { error } = await this.supabase.from("rooms").update({ last_activity_at: atIso }).eq("id", roomId)
    if (error) return
  }

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase credentials")
    }

    this.supabase = createClient(supabaseUrl, supabaseKey)
  }

  async joinRoom(roomId: string, user: User): Promise<RoomData> {
    // 1. Ensure room exists
    const { error: roomError } = await this.supabase
      .from("rooms")
      .upsert({ id: roomId }, { onConflict: "id", ignoreDuplicates: true })

    if (roomError) {
      console.error("Supabase room upsert error:", roomError)
      throw roomError
    }

    // 2. Upsert user
    const { error: userError } = await this.supabase
      .from("room_users")
      .upsert(
        {
          room_id: roomId,
          user_id: user.id,
          data: user,
        },
        { onConflict: "room_id,user_id" },
      )

    if (userError) {
      console.error("Supabase user upsert error:", userError)
      throw userError
    }

    const room = await this.getRoom(roomId)
    if (!room) throw new Error("Failed to fetch room after joining")
    return room
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    await this.supabase
      .from("room_users")
      .delete()
      .match({ room_id: roomId, user_id: userId })
  }

  async sendMessage(roomId: string, message: Message): Promise<Message> {
    const { error } = await this.supabase
      .from("room_messages")
      .insert({
        room_id: roomId,
        data: message,
      })

    if (error) {
      console.error("Supabase send message error:", error)
      throw error
    }
    await this.touchRoomActivity(roomId, new Date().toISOString())
    return message
  }

  async getRoom(roomId: string): Promise<RoomData | null> {
    const [roomResult, usersResult, messagesResult] = await Promise.all([
      this.supabase.from("rooms").select("created_at").eq("id", roomId).maybeSingle(),
      this.supabase.from("room_users").select("data").eq("room_id", roomId),
      this.supabase
        .from("room_messages")
        .select("data")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true }),
    ])

    if (roomResult.error) {
      console.error("Supabase fetch room error:", roomResult.error)
      return null
    }
    if (!roomResult.data) return null
    if (usersResult.error) {
      console.error("Supabase fetch users error:", usersResult.error)
      return null
    }
    if (messagesResult.error) {
      console.error("Supabase fetch messages error:", messagesResult.error)
      return null
    }

    const createdAt =
      typeof (roomResult.data as { created_at?: unknown }).created_at === "string"
        ? ((roomResult.data as { created_at: string }).created_at as string)
        : undefined

    const usersRows = (usersResult.data ?? []) as Array<{ data: User }>
    const messageRows = (messagesResult.data ?? []) as Array<{ data: Message }>

    const users = usersRows.map((r) => r.data)
    const messages = messageRows.map((r) => r.data)

    return {
      id: roomId,
      users,
      messages,
      createdAt,
    }
  }
}
