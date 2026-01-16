import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let supabaseBrowserClient: SupabaseClient | null = null

function getPerTabStorageKey(): string | undefined {
  if (typeof window === "undefined") return undefined
  const tabIdKey = "voicelink_supabase_tab_id"
  const existing = window.sessionStorage.getItem(tabIdKey)
  if (existing) return `voicelink_auth_${existing}`

  const created =
    typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : Math.random().toString(36).slice(2, 12)
  window.sessionStorage.setItem(tabIdKey, created)
  return `voicelink_auth_${created}`
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (supabaseBrowserClient) return supabaseBrowserClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase public credentials")
  }

  const storageKey = getPerTabStorageKey()

  supabaseBrowserClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
      storageKey,
    },
  })

  return supabaseBrowserClient
}
