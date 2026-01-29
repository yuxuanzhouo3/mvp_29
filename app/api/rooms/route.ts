import { type NextRequest, NextResponse } from "next/server"
import { getRoomStore } from "@/lib/store"
import type { Message } from "@/lib/store/types"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { Prisma } from "@prisma/client"
import { getPrisma } from "@/lib/prisma"
import crypto from "node:crypto"

const ROOM_TTL_MS = 24 * 60 * 60 * 1000
const SETTINGS_KEY = "rooms_auto_delete_after_24h"
const ROOM_ACTIVITY_COLUMN = "last_activity_at"
const ROOM_SETTINGS_PREFIX = "room:"

type SettingsCache = { value: boolean; fetchedAt: number }
type CleanupCache = { lastRunAt: number }
type MysqlClient = Awaited<ReturnType<typeof getPrisma>>
type SettingsStore =
  | { kind: "supabase"; client: SupabaseClient }
  | { kind: "mysql"; client: MysqlClient }
  | { kind: "memory" }

const globalForRoomSettings = globalThis as unknown as {
  __voicelinkRoomAutoDeleteCache?: SettingsCache
  __voicelinkRoomCleanupCache?: CleanupCache
  __voicelinkRoomJoinSettings?: Map<string, unknown>
}

function isTencentTarget(): boolean {
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
    .trim()
    .toLowerCase()
  return target === "tencent"
}

function getSupabaseClient(): SupabaseClient | null {
  if (isTencentTarget()) return null
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !supabaseKey) return null
  return createClient(supabaseUrl, supabaseKey)
}

async function getSettingsStore(): Promise<SettingsStore> {
  const supabase = getSupabaseClient()
  if (supabase) return { kind: "supabase", client: supabase }
  if (isTencentTarget()) {
    const client = await getPrisma()
    return { kind: "mysql", client }
  }
  return { kind: "memory" }
}

function extractEnabledFromSettingValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.enabled === "boolean") return v.enabled
  return null
}

async function getSettingValue(store: SettingsStore, key: string): Promise<unknown | null> {
  if (store.kind === "supabase") {
    const { data, error } = await store.client.from("app_settings").select("value").eq("key", key).maybeSingle()
    if (error || !data) return null
    return (data as { value?: unknown } | null)?.value ?? null
  }
  if (store.kind === "mysql") {
    const data = await store.client.appSetting.findUnique({ where: { key } })
    return data?.value ?? null
  }
  return getInMemorySettingsStore().get(key) ?? null
}

async function setSettingValue(store: SettingsStore, key: string, value: unknown): Promise<void> {
  if (store.kind === "supabase") {
    await store.client
      .from("app_settings")
      .upsert(
        {
          key,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      )
    return
  }
  if (store.kind === "mysql") {
    const nextValue = value as Prisma.InputJsonValue
    await store.client.$executeRaw(
      Prisma.sql`
        INSERT INTO app_settings (\`key\`, \`value\`, updated_at, _openid)
        VALUES (${key}, CAST(${JSON.stringify(nextValue)} AS JSON), NOW(), '')
        ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = VALUES(updated_at)
      `
    )
    return
  }
  getInMemorySettingsStore().set(key, value)
}

async function getRoomAutoDeleteEnabled(store: SettingsStore): Promise<boolean> {
  const cached = globalForRoomSettings.__voicelinkRoomAutoDeleteCache
  if (cached && Date.now() - cached.fetchedAt < 30_000) return cached.value

  const value = await getSettingValue(store, SETTINGS_KEY)
  const enabled = extractEnabledFromSettingValue(value) ?? false
  globalForRoomSettings.__voicelinkRoomAutoDeleteCache = { value: enabled, fetchedAt: Date.now() }
  return enabled
}

async function maybeCleanupExpiredRooms(store: SettingsStore): Promise<void> {
  const cache = globalForRoomSettings.__voicelinkRoomCleanupCache
  const now = Date.now()
  if (cache && now - cache.lastRunAt < 10 * 60_000) return

  globalForRoomSettings.__voicelinkRoomCleanupCache = { lastRunAt: now }
  const enabled = await getRoomAutoDeleteEnabled(store)
  if (!enabled) return

  if (store.kind === "supabase") {
    const cutoff = new Date(now - ROOM_TTL_MS).toISOString()
    const { error } = await store.client
      .from("rooms")
      .delete()
      .or(`and(${ROOM_ACTIVITY_COLUMN}.is.null,created_at.lt.${cutoff}),${ROOM_ACTIVITY_COLUMN}.lt.${cutoff}`)
    if (error) {
      await store.client.from("rooms").delete().lt("created_at", cutoff)
    }
    return
  }
  if (store.kind === "mysql") {
    const cutoff = new Date(now - ROOM_TTL_MS)
    await store.client.room.deleteMany({
      where: {
        OR: [{ lastActivityAt: { lt: cutoff } }, { createdAt: { lt: cutoff } }],
      },
    })
  }
}

async function cleanupRoomIfExpired(store: SettingsStore, roomId: string): Promise<boolean> {
  const enabled = await getRoomAutoDeleteEnabled(store)
  if (!enabled) return false

  if (store.kind === "supabase") {
    const { data, error } = await store.client
      .from("rooms")
      .select(`created_at,${ROOM_ACTIVITY_COLUMN}`)
      .eq("id", roomId)
      .maybeSingle()
    if (error) {
      const fallback = await store.client.from("rooms").select("created_at").eq("id", roomId).maybeSingle()
      if (fallback.error || !fallback.data) return false
      const createdAt = (fallback.data as { created_at?: unknown }).created_at
      if (typeof createdAt !== "string") return false
      const createdMs = Date.parse(createdAt)
      if (!Number.isFinite(createdMs)) return false
      if (Date.now() - createdMs <= ROOM_TTL_MS) return false
      await store.client.from("rooms").delete().eq("id", roomId)
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

    await store.client.from("rooms").delete().eq("id", roomId)
    return true
  }

  if (store.kind === "mysql") {
    const room = await store.client.room.findUnique({
      where: { id: roomId },
      select: { createdAt: true, lastActivityAt: true },
    })
    if (!room) return false
    const createdMs = room.createdAt ? room.createdAt.getTime() : Number.NaN
    const lastActivityMs = room.lastActivityAt ? room.lastActivityAt.getTime() : Number.NaN
    const effectiveMs = Number.isFinite(lastActivityMs)
      ? lastActivityMs
      : Number.isFinite(createdMs)
        ? createdMs
        : Number.NaN
    if (!Number.isFinite(effectiveMs)) return false
    if (Date.now() - effectiveMs <= ROOM_TTL_MS) return false
    await store.client.room.delete({ where: { id: roomId } })
    return true
  }

  return false
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

type JoinSessionPolicy = "allow" | "single_account"

function normalizeJoinSessionPolicy(value: unknown): JoinSessionPolicy {
  if (typeof value !== "string") return "allow"
  const v = value.trim().toLowerCase()
  if (v === "single_account" || v === "single-account" || v === "singleaccount") return "single_account"
  return "allow"
}

function getJoinSessionPolicy(): JoinSessionPolicy {
  const direct = normalizeJoinSessionPolicy(process.env.VOICELINK_JOIN_SESSION_POLICY)
  if (direct !== "allow") return direct

  const flag = String(process.env.VOICELINK_KICK_SAME_ACCOUNT_ON_JOIN ?? "").trim().toLowerCase()
  if (flag === "1" || flag === "true" || flag === "yes" || flag === "on") return "single_account"

  return "allow"
}

function getAccountIdFromUserId(userId: string): string | null {
  const raw = typeof userId === "string" ? userId.trim() : ""
  if (!raw) return null
  const idx = raw.indexOf(":")
  if (idx <= 0) return null
  const base = raw.slice(0, idx).trim()
  if (!base) return null
  return base
}

type RoomJoinMode = "public" | "password"

type RoomSettings = {
  adminUserId: string
  joinMode: RoomJoinMode
  passwordSalt?: string
  passwordHash?: string
  updatedAt?: string
}

function getRoomSettingsKey(roomId: string) {
  return `${ROOM_SETTINGS_PREFIX}${roomId}:settings`
}

function getInMemorySettingsStore() {
  if (!globalForRoomSettings.__voicelinkRoomJoinSettings) {
    globalForRoomSettings.__voicelinkRoomJoinSettings = new Map()
  }
  return globalForRoomSettings.__voicelinkRoomJoinSettings
}

function normalizeJoinMode(value: unknown): RoomJoinMode | null {
  if (value === "public" || value === "password") return value
  return null
}

function parseRoomSettings(value: unknown): RoomSettings | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  if (!isNonEmptyString(v.adminUserId)) return null
  const joinMode = normalizeJoinMode(v.joinMode)
  if (!joinMode) return null
  const passwordSalt = typeof v.passwordSalt === "string" ? v.passwordSalt : undefined
  const passwordHash = typeof v.passwordHash === "string" ? v.passwordHash : undefined
  const updatedAt = typeof v.updatedAt === "string" ? v.updatedAt : undefined
  return { adminUserId: v.adminUserId.trim(), joinMode, passwordSalt, passwordHash, updatedAt }
}

function derivePasswordHash(password: string, saltBase64: string) {
  const salt = Buffer.from(saltBase64, "base64")
  const hash = crypto.scryptSync(password, salt, 32)
  return hash.toString("base64")
}

function hashPasswordForStorage(password: string) {
  const salt = crypto.randomBytes(16)
  const saltBase64 = salt.toString("base64")
  const hashBase64 = derivePasswordHash(password, saltBase64)
  return { saltBase64, hashBase64 }
}

function verifyPassword(password: string, saltBase64: string, expectedHashBase64: string) {
  const actual = derivePasswordHash(password, saltBase64)
  const a = Buffer.from(actual, "base64")
  const b = Buffer.from(expectedHashBase64, "base64")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

async function getRoomSettings(store: SettingsStore, roomId: string): Promise<RoomSettings | null> {
  const key = getRoomSettingsKey(roomId)
  const value = await getSettingValue(store, key)
  return parseRoomSettings(value)
}

async function setRoomSettings(store: SettingsStore, roomId: string, settings: RoomSettings): Promise<void> {
  const key = getRoomSettingsKey(roomId)
  const value: RoomSettings = { ...settings, updatedAt: new Date().toISOString() }
  await setSettingValue(store, key, value)
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
    const joinPassword = body.joinPassword
    const createJoinMode = body.createJoinMode
    const createPassword = body.createPassword
    const settingsJoinMode = body.joinMode
    const settingsPassword = body.password
    const targetUserId = body.targetUserId

    if (typeof action !== "string" || action.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
    }

    const store = getRoomStore()
    const settingsStore = await getSettingsStore()
    if (settingsStore.kind !== "memory") {
      await maybeCleanupExpiredRooms(settingsStore)
    }

    if (action === "inspect") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      const rid = roomId.trim()
      const [room, settings] = await Promise.all([
        store.getRoom(rid).catch(() => null),
        getRoomSettings(settingsStore, rid).catch(() => null),
      ])
      const exists = Boolean(settings) || Boolean(room)
      const joinMode = settings?.joinMode ?? "public"
      const requiresPassword = joinMode === "password"
      return NextResponse.json({
        success: true,
        exists,
        settings: settings
          ? { adminUserId: settings.adminUserId, joinMode: settings.joinMode, requiresPassword }
          : exists
            ? { adminUserId: room?.users?.[0]?.id ?? null, joinMode, requiresPassword }
            : null,
      })
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

      if (settingsStore.kind !== "memory") {
        await cleanupRoomIfExpired(settingsStore, roomId.trim())
      }

      const rid = roomId.trim()
      const uid = userId.trim()
      let existingRoom = await store.getRoom(rid).catch(() => null)
      let settings = await getRoomSettings(settingsStore, rid).catch(() => null)
      const requestedCreateJoinMode = normalizeJoinMode(createJoinMode) ?? null
      const requestedCreatePassword = typeof createPassword === "string" ? createPassword : null
      const joinSessionPolicy = getJoinSessionPolicy()
      const accountId = getAccountIdFromUserId(uid)

      if (joinSessionPolicy === "single_account" && accountId && existingRoom?.users?.length) {
        const staleUserIds = existingRoom.users
          .map((u) => u.id)
          .filter((id) => id !== uid && getAccountIdFromUserId(id) === accountId)

        if (staleUserIds.length > 0) {
          await Promise.all(staleUserIds.map((staleId) => store.leaveRoom(rid, staleId).catch(() => null)))
          existingRoom = await store.getRoom(rid).catch(() => null)
        }

        if (settings && getAccountIdFromUserId(settings.adminUserId) === accountId && settings.adminUserId !== uid) {
          const next: RoomSettings = { ...settings, adminUserId: uid }
          await setRoomSettings(settingsStore, rid, next)
          settings = next
        }
      }

      if (!settings) {
        const canClaimAdmin = !existingRoom || existingRoom.users.length === 0
        const adminUserId = canClaimAdmin ? uid : existingRoom?.users?.[0]?.id ?? uid
        const joinMode: RoomJoinMode =
          requestedCreateJoinMode ?? (requestedCreatePassword && requestedCreatePassword.trim() ? "password" : "public")
        const next: RoomSettings = { adminUserId, joinMode }
        if (joinMode === "password") {
          const passwordValue = requestedCreatePassword?.trim() ?? ""
          if (!passwordValue) {
            return NextResponse.json({ success: false, error: "Password required" }, { status: 400 })
          }
          const { saltBase64, hashBase64 } = hashPasswordForStorage(passwordValue)
          next.passwordSalt = saltBase64
          next.passwordHash = hashBase64
        }
        await setRoomSettings(settingsStore, rid, next)
        settings = next
      } else {
        if (settings.joinMode === "password") {
          const passwordValue = typeof joinPassword === "string" ? joinPassword.trim() : ""
          if (!passwordValue) {
            return NextResponse.json({ success: false, error: "Password required" }, { status: 401 })
          }
          if (!settings.passwordSalt || !settings.passwordHash) {
            return NextResponse.json({ success: false, error: "Password config invalid" }, { status: 500 })
          }
          const ok = verifyPassword(passwordValue, settings.passwordSalt, settings.passwordHash)
          if (!ok) {
            return NextResponse.json({ success: false, error: "Invalid password" }, { status: 401 })
          }
        }
      }

      const avatar =
        typeof avatarUrl === "string" && avatarUrl.trim().length > 0
          ? avatarUrl.trim()
          : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userId)}`

      const roomData = await store.joinRoom(rid, {
        id: uid,
        name: userName.trim(),
        sourceLanguage: sourceLanguage.trim(),
        targetLanguage: targetLanguage.trim(),
        avatar,
      })

      return NextResponse.json({
        success: true,
        room: roomData,
        settings: settings ? { adminUserId: settings.adminUserId, joinMode: settings.joinMode } : null,
      })
    }

    if (action === "leave") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 })
      }

      if (settingsStore.kind !== "memory") {
        const expired = await cleanupRoomIfExpired(settingsStore, roomId.trim())
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      await store.leaveRoom(roomId.trim(), userId.trim())
      return NextResponse.json({ success: true })
    }

    if (action === "update_settings") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 })
      }
      const rid = roomId.trim()
      const uid = userId.trim()
      const current = await getRoomSettings(settingsStore, rid)
      if (!current) {
        return NextResponse.json({ success: false, error: "Room settings not found" }, { status: 404 })
      }
      if (current.adminUserId !== uid) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
      }
      const nextMode = normalizeJoinMode(settingsJoinMode)
      if (!nextMode) {
        return NextResponse.json({ success: false, error: "Invalid joinMode" }, { status: 400 })
      }

      const next: RoomSettings = { adminUserId: current.adminUserId, joinMode: nextMode }
      if (nextMode === "password") {
        const passwordValue = typeof settingsPassword === "string" ? settingsPassword.trim() : ""
        const keepExisting = !passwordValue && current.passwordSalt && current.passwordHash
        if (keepExisting) {
          next.passwordSalt = current.passwordSalt
          next.passwordHash = current.passwordHash
        } else {
          if (!passwordValue) {
            return NextResponse.json({ success: false, error: "Password required" }, { status: 400 })
          }
          const { saltBase64, hashBase64 } = hashPasswordForStorage(passwordValue)
          next.passwordSalt = saltBase64
          next.passwordHash = hashBase64
        }
      }
      await setRoomSettings(settingsStore, rid, next)
      return NextResponse.json({ success: true, settings: { adminUserId: next.adminUserId, joinMode: next.joinMode } })
    }

    if (action === "kick") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 })
      }
      if (typeof targetUserId !== "string" || targetUserId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid targetUserId" }, { status: 400 })
      }
      const rid = roomId.trim()
      const uid = userId.trim()
      const tid = targetUserId.trim()
      const settings = await getRoomSettings(settingsStore, rid)
      if (!settings) {
        return NextResponse.json({ success: false, error: "Room settings not found" }, { status: 404 })
      }
      if (settings.adminUserId !== uid) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
      }
      if (settings.adminUserId === tid) {
        return NextResponse.json({ success: false, error: "Cannot kick admin" }, { status: 400 })
      }

      if (settingsStore.kind !== "memory") {
        const expired = await cleanupRoomIfExpired(settingsStore, rid)
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      await store.leaveRoom(rid, tid)
      return NextResponse.json({ success: true })
    }

    if (action === "update_language") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 })
      }
      if (typeof sourceLanguage !== "string" || sourceLanguage.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid sourceLanguage" }, { status: 400 })
      }
      if (typeof targetLanguage !== "string" || targetLanguage.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid targetLanguage" }, { status: 400 })
      }

      if (settingsStore.kind !== "memory") {
        const expired = await cleanupRoomIfExpired(settingsStore, roomId.trim())
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      const rid = roomId.trim()
      const uid = userId.trim()
      const roomData = await store.getRoom(rid)
      if (!roomData) {
        return NextResponse.json({ success: false, error: "Room not found" }, { status: 404 })
      }
      const existingUser = roomData.users.find((u) => u.id === uid)
      if (!existingUser) {
        return NextResponse.json({ success: false, error: "User not found" }, { status: 404 })
      }

      const nextUser = {
        ...existingUser,
        sourceLanguage: sourceLanguage.trim(),
        targetLanguage: targetLanguage.trim(),
      }

      await store.joinRoom(rid, nextUser)
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

      if (settingsStore.kind !== "memory") {
        const expired = await cleanupRoomIfExpired(settingsStore, roomId.trim())
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      const savedMessage = await store.sendMessage(roomId.trim(), parsedMessage)
      if (settingsStore.kind === "supabase") {
        await settingsStore.client
          .from("rooms")
          .update({ [ROOM_ACTIVITY_COLUMN]: new Date().toISOString() })
          .eq("id", roomId.trim())
      }
      return NextResponse.json({ success: true, message: savedMessage })
    }

    if (action === "poll") {
      if (typeof roomId !== "string" || roomId.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 })
      }

      if (settingsStore.kind !== "memory") {
        const expired = await cleanupRoomIfExpired(settingsStore, roomId.trim())
        if (expired) {
          return NextResponse.json({ success: false, error: "Room expired" }, { status: 410 })
        }
      }

      const roomData = await store.getRoom(roomId.trim())
      if (!roomData) {
        return NextResponse.json({ success: false, error: "Room not found" }, { status: 404 })
      }

      const settings = await getRoomSettings(settingsStore, roomId.trim()).catch(() => null)
      return NextResponse.json({
        success: true,
        room: roomData,
        settings: settings ? { adminUserId: settings.adminUserId, joinMode: settings.joinMode } : null,
      })
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[v0] Room API error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
