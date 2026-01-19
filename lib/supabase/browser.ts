import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let supabaseBrowserClient: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient {
  if (supabaseBrowserClient) return supabaseBrowserClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !supabaseKey) {
    if (typeof window === "undefined") {
      return createClient("https://placeholder.supabase.co", "placeholder", {
        auth: { persistSession: false },
      })
    }
    throw new Error("Missing Supabase public credentials")
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
