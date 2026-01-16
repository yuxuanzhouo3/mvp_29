import { type NextRequest, NextResponse } from "next/server"
import { getRoomStore } from "@/lib/store"
import type { Message } from "@/lib/store/types"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const ROOM_TTL_MS = 24 * 60 * 60 * 1000
const SETTINGS_KEY = "rooms_auto_delete_after_24h"
const ROOM_ACTIVITY_COLUMN = "last_activity_at"

type SettingsCache = { value: boolean; fetchedAt: number }
type CleanupCache = { lastRunAt: number }

const globalForRoomSettings = globalThis as unknown as {
  __voicelinkRoomAutoDeleteCache?: SettingsCache
  __voicelinkRoomCleanupCache?: CleanupCache
}

function getSupabaseClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !supabaseKey) return null
  return createClient(supabaseUrl, supabaseKey)
}

function extractEnabledFromSettingValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.enabled === "boolean") return v.enabled
  return null
}

async function getRoomAutoDeleteEnabled(supabase: SupabaseClient): Promise<boolean> {
  const cached = globalForRoomSettings.__voicelinkRoomAutoDeleteCache
  if (cached && Date.now() - cached.fetchedAt < 30_000) return cached.value

  const { data, error } = await supabase.from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle()
  if (error) {
    globalForRoomSettings.__voicelinkRoomAutoDeleteCache = { value: false, fetchedAt: Date.now() }
    return false
  }

  const enabled = extractEnabledFromSettingValue((data as { value?: unknown } | null)?.value) ?? false
  globalForRoomSettings.__voicelinkRoomAutoDeleteCache = { value: enabled, fetchedAt: Date.now() }
  return enabled
}

async function maybeCleanupExpiredRooms(supabase: SupabaseClient): Promise<void> {
  const cache = globalForRoomSettings.__voicelinkRoomCleanupCache
  const now = Date.now()
  if (cache && now - cache.lastRunAt < 10 * 60_000) return

  globalForRoomSettings.__voicelinkRoomCleanupCache = { lastRunAt: now }
  const enabled = await getRoomAutoDeleteEnabled(supabase)
  if (!enabled) return

  const cutoff = new Date(now - ROOM_TTL_MS).toISOString()
  const { error } = await supabase
    .from("rooms")
    .delete()
    .or(`and(${ROOM_ACTIVITY_COLUMN}.is.null,created_at.lt.${cutoff}),${ROOM_ACTIVITY_COLUMN}.lt.${cutoff}`)
  if (error) {
    await supabase.from("rooms").delete().lt("created_at", cutoff)
  }
}

async function cleanupRoomIfExpired(supabase: SupabaseClient, roomId: string): Promise<boolean> {
  const enabled = await getRoomAutoDeleteEnabled(supabase)
  if (!enabled) return false

  const { data, error } = await supabase
    .from("rooms")
    .select(`created_at,${ROOM_ACTIVITY_COLUMN}`)
    .eq("id", roomId)
    .maybeSingle()
  if (error) {
    const fallback = await supabase.from("rooms").select("created_at").eq("id", roomId).maybeSingle()
    if (fallback.error || !fallback.data) return false
    const createdAt = (fallback.data as { created_at?: unknown }).created_at
    if (typeof createdAt !== "string") return false
    const createdMs = Date.parse(createdAt)
    if (!Number.isFinite(createdMs)) return false
    if (Date.now() - createdMs <= ROOM_TTL_MS) return false
    await supabase.from("rooms").delete().eq("id", roomId)
    return true
  }
  if (!data) return false

  const createdAt = (data as { created_at?: unknown }).created_at
  const lastActivityAt = (data as Record<string, unknown>)[ROOM_ACTIVITY_COLUMN]

  const createdAtStr = typeof createdAt === "string" ? createdAt : null
  const lastActivityStr = typeof lastActivityAt === "string" ? lastActivityAt : null

  const createdMs = createdAtStr ? Date.parse(createdAtStr) : Number.NaN
  const lastActivityMs = lastActivityStr ? Date.parse(lastActivityStr) : Number.NaN
  const effectiveMs = Number.isFinite(lastActivityMs)
    ? lastActivityMs
    : Number.isFinite(createdMs)
      ? createdMs
      : Number.NaN

  if (!Number.isFinite(effectiveMs)) return false
  if (Date.now() - effectiveMs <= ROOM_TTL_MS) return false

  await supabase.from("rooms").delete().eq("id", roomId)
  return true
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function parseMessage(value: unknown): Message | null {
  if (typeof value !== "object" || value === null) return null
  const msg = value as Record<string, unknown>

  if (!isNonEmptyString(msg.id)) return null
  if (!isNonEmptyString(msg.userId)) return null
  if (!isNonEmptyString(msg.userName)) return null
  if (!isNonEmptyString(msg.originalText)) return null
  if (!isNonEmptyString(msg.originalLanguage)) return null
  if (!isNonEmptyString(msg.timestamp)) return null

  const audioUrl = typeof msg.audioUrl === "string" ? msg.audioUrl : undefined
  const translatedText = typeof msg.translatedText === "string" ? msg.translatedText : undefined
  const targetLanguage = typeof msg.targetLanguage === "string" ? msg.targetLanguage : undefined

  return {
    id: msg.id,
    userId: msg.userId,
    userName: msg.userName,
    originalText: msg.originalText,
    originalLanguage: msg.originalLanguage,
    timestamp: msg.timestamp,
    audioUrl,
    translatedText,
    targetLanguage,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }

    const action = body.action
    const roomId = body.roomId
    const userId = body.userId
    const userName = body.userName
    const sourceLanguage = body.sourceLanguage
    const targetLanguage = body.targetLanguage
    const message = body.message
    const avatarUrl = body.avatarUrl

    if (typeof action !== "string" || action.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
    }

    const store = getRoomStore()
    const supabase = getSupabaseClient()
    if (supabase) {
      await maybeCleanupExpiredRooms(supabase)
    }

    if (action === "join") {
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

      if (supabase) {
        await cleanupRoomIfExpired(supabase, roomId.trim())
      }

      const avatar =
        typeof avatarUrl === "string" && avatarUrl.trim().length > 0
          ? avatarUrl.trim()
          : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userId)}`

      const roomData = await store.joinRoom(roomId.trim(), {
        id: userId.trim(),
        name: userName.trim(),
        sourceLanguage: sourceLanguage.trim(),
        targetLanguage: targetLanguage.trim(),
        avatar,
      })

      return NextResponse.json({ success: true, room: roomData })
    }

    if (action === "leave") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 })
      }

      if (supabase) {
        const expired = await cleanupRoomIfExpired(supabase, roomId.trim())
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      await store.leaveRoom(roomId.trim(), userId.trim())
      return NextResponse.json({ success: true })
    }

    if (action === "message") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      const parsedMessage = parseMessage(message)
      if (!parsedMessage) {
        return NextResponse.json({ success: false, error: "Invalid message" }, { status: 400 })
      }

      if (supabase) {
        const expired = await cleanupRoomIfExpired(supabase, roomId.trim())
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      const savedMessage = await store.sendMessage(roomId.trim(), parsedMessage)
      if (supabase) {
        await supabase.from("rooms").update({ [ROOM_ACTIVITY_COLUMN]: new Date().toISOString() }).eq("id", roomId.trim())
      }
      return NextResponse.json({ success: true, message: savedMessage })
    }

    if (action === "poll") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }

      if (supabase) {
        const expired = await cleanupRoomIfExpired(supabase, roomId.trim())
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      const roomData = await store.getRoom(roomId.trim())
      if (!roomData) {
        return NextResponse.json({ success: false, error: "Room not found" }, { status: 404 })
      }

      return NextResponse.json({ success: true, room: roomData })
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[v0] Room API error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
