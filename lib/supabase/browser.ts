import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let supabaseBrowserClient: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient {
  if (supabaseBrowserClient) return supabaseBrowserClient

  // 国内版环境直接返回 Dummy Client，避免检查 Supabase 环境变量
  if (process.env.NEXT_PUBLIC_DEPLOY_TARGET === "tencent") {
    if (!supabaseBrowserClient) {
      console.log("Tencent environment detected, using dummy Supabase client")
      supabaseBrowserClient = createClient("https://placeholder.supabase.co", "placeholder", {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    }
    return supabaseBrowserClient
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !supabaseKey) {
    if (typeof window === "undefined") {
      return createClient("https://placeholder.supabase.co", "placeholder", {
        auth: { persistSession: false },
      })
    }
    // Return a dummy client instead of throwing, to support environments without Supabase
    console.warn("Missing Supabase public credentials, falling back to dummy client")
    return createClient("https://placeholder.supabase.co", "placeholder", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }

  supabaseBrowserClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      storageKey: "voicelink_auth",
    },
  })

  return supabaseBrowserClient
}
