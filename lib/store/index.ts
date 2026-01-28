import { RoomStore } from "./types"
import { MemoryRoomStore } from "./memory"
import { SupabaseRoomStore } from "./supabase"
import { CloudBaseRoomStore } from "./cloudbase"
import { MysqlRoomStore } from "./mysql"

let storeInstance: RoomStore | null = null

export function getRoomStore(): RoomStore {
  if (storeInstance) return storeInstance

  // 1. Explicit override via env var
  if (process.env.DB_PROVIDER === 'supabase') {
    console.log("[RoomStore] Using Supabase (Explicit)")
    storeInstance = new SupabaseRoomStore()
    return storeInstance
  }
  if (process.env.DB_PROVIDER === 'cloudbase') {
    console.log("[RoomStore] Using CloudBase (Explicit)")
    storeInstance = new CloudBaseRoomStore()
    return storeInstance
  }
  if (process.env.DB_PROVIDER === 'mysql') {
    console.log("[RoomStore] Using MySQL (Explicit)")
    storeInstance = new MysqlRoomStore()
    return storeInstance
  }
  if (process.env.DB_PROVIDER === 'memory') {
    console.log("[RoomStore] Using Memory (Explicit)")
    storeInstance = new MemoryRoomStore()
    return storeInstance
  }

  // 2. Auto-detect Platform
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
    .trim()
    .toLowerCase()
  if (target === "tencent") {
    console.log("[RoomStore] Detected Tencent Target - Using MySQL")
    try {
      storeInstance = new MysqlRoomStore()
      return storeInstance
    } catch (e) {
      console.warn("[RoomStore] Failed to initialize MySQL, falling back:", e)
    }
  }
  // Vercel deployment -> Supabase
  if (process.env.VERCEL) {
    console.log("[RoomStore] Detected Vercel Environment - Using Supabase")
    try {
        storeInstance = new SupabaseRoomStore()
        return storeInstance
    } catch (e) {
        console.warn("[RoomStore] Failed to initialize Supabase, falling back to Memory:", e)
    }
  }

  // CloudBase deployment -> CloudBase
  // Detects if running in Tencent Cloud environment or if explicitly configured for it
  // TENCENTCLOUD_RUNENV is often present in CloudBase container/functions
  if (process.env.TENCENTCLOUD_RUNENV || process.env.TENCENT_APP_ID) {
     console.log("[RoomStore] Detected CloudBase Environment - Using CloudBase")
     try {
        storeInstance = new CloudBaseRoomStore()
        return storeInstance
     } catch (e) {
        console.warn("[RoomStore] Failed to initialize CloudBase, falling back to Memory:", e)
     }
  }

  // 3. Fallback
  console.log("[RoomStore] No specific cloud environment detected - Using Memory Store")
  storeInstance = new MemoryRoomStore()
  return storeInstance
}
