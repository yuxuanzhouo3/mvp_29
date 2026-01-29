import { getMariaPool } from "@/lib/prisma"
import { RoomStore, RoomData, User, Message } from "./types"
import crypto from "node:crypto"

const globalForMysql = globalThis as unknown as {
  __voicelinkOpenidColumnCache?: Map<string, { value: boolean; checkedAt: number }>
}

const OPENID_CACHE_TTL_MS = 10 * 60_000

export class MysqlRoomStore implements RoomStore {
  private async ensureOpenidColumn(pool: any, tableName: string): Promise<void> {
    try {
      if (!globalForMysql.__voicelinkOpenidColumnCache) {
        globalForMysql.__voicelinkOpenidColumnCache = new Map()
      }
      const cache = globalForMysql.__voicelinkOpenidColumnCache
      const cached = cache.get(tableName)
      if (cached && Date.now() - cached.checkedAt < OPENID_CACHE_TTL_MS) {
        if (cached.value) return
      }
      const rows = await pool.query(
        `SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${tableName}' AND column_name = '_openid'`
      )
      const count = Array.isArray(rows) && rows.length > 0 ? Number(rows[0].cnt || 0) : 0
      let exists = count > 0
      if (!exists) {
        await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`_openid\` VARCHAR(64) DEFAULT '' NOT NULL`)
        exists = true
      }
      cache.set(tableName, { value: exists, checkedAt: Date.now() })
    } catch (e) {
      console.warn(`[MysqlRoomStore] Failed to ensure _openid on ${tableName}:`, e)
      if (!globalForMysql.__voicelinkOpenidColumnCache) {
        globalForMysql.__voicelinkOpenidColumnCache = new Map()
      }
      globalForMysql.__voicelinkOpenidColumnCache.set(tableName, { value: false, checkedAt: Date.now() })
    }
  }

  async joinRoom(roomId: string, user: User): Promise<RoomData> {
    const pool = await getMariaPool()
    await this.ensureOpenidColumn(pool, 'rooms')
    await this.ensureOpenidColumn(pool, 'room_users')

    await pool.query(
      "INSERT INTO `rooms` (id, created_at, last_activity_at, _openid) VALUES (?, NOW(), NOW(), ?) ON DUPLICATE KEY UPDATE last_activity_at = NOW()",
      [roomId, ""]
    )
    await pool.query(
      "INSERT INTO `room_users` (room_id, user_id, data, created_at, _openid) VALUES (?, ?, ?, NOW(), ?) ON DUPLICATE KEY UPDATE data = VALUES(data)",
      [roomId, user.id, JSON.stringify(user), ""]
    )

    const room = await this.getRoom(roomId)
    if (!room) throw new Error("Failed to fetch room after joining")
    return room
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    const pool = await getMariaPool()
    await pool.query("DELETE FROM `room_users` WHERE room_id = ? AND user_id = ?", [roomId, userId])
  }

  async sendMessage(roomId: string, message: Message): Promise<Message> {
    const pool = await getMariaPool()
    await this.ensureOpenidColumn(pool, 'room_messages')

    const id = message.id?.trim() ? message.id : crypto.randomUUID()
    await pool.query(
      "INSERT INTO `room_messages` (id, room_id, data, created_at, _openid) VALUES (?, ?, ?, NOW(), ?)",
      [id, roomId, JSON.stringify({ ...message, id }), ""]
    )
    await pool.query("UPDATE `rooms` SET last_activity_at = NOW() WHERE id = ?", [roomId])
    return { ...message, id }
  }

  async getRoom(roomId: string): Promise<RoomData | null> {
    const pool = await getMariaPool()
    const roomRows = await pool.query("SELECT id, created_at FROM `rooms` WHERE id = ? LIMIT 1", [roomId])
    const room = Array.isArray(roomRows) && roomRows.length > 0 ? roomRows[0] : null
    if (!room) return null

    const userRows = await pool.query("SELECT data FROM `room_users` WHERE room_id = ?", [roomId])
    const messageRows = await pool.query("SELECT data FROM `room_messages` WHERE room_id = ? ORDER BY created_at ASC", [
      roomId,
    ])

    const users = (Array.isArray(userRows) ? userRows : [])
      .map((row) => {
        const raw = row?.data
        if (!raw) return null
        try {
          return typeof raw === "string" ? (JSON.parse(raw) as User) : (raw as User)
        } catch {
          return null
        }
      })
      .filter((u): u is User => Boolean(u))

    const messages = (Array.isArray(messageRows) ? messageRows : [])
      .map((row) => {
        const raw = row?.data
        if (!raw) return null
        try {
          return typeof raw === "string" ? (JSON.parse(raw) as Message) : (raw as Message)
        } catch {
          return null
        }
      })
      .filter((m): m is Message => Boolean(m))

    const createdAtRaw = room?.created_at ?? room?.createdAt ?? null
    const createdAt =
      createdAtRaw instanceof Date
        ? createdAtRaw.toISOString()
        : typeof createdAtRaw === "string"
          ? new Date(createdAtRaw).toISOString()
          : new Date().toISOString()

    return {
      id: roomId,
      users,
      messages,
      createdAt,
    }
  }
}
