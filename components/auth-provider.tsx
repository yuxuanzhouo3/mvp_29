"use client"

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

export type Profile = {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
}

type AuthContextValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  isLoading: boolean
  refreshProfile: () => Promise<void>
  updateProfile: (patch: { display_name?: string; avatar_url?: string }) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshProfile = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setProfile(null)
      return
    }

    const supabase = getSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url")
      .eq("id", currentUser.id)
      .maybeSingle()

    if (error) {
      console.error("Error fetching profile:", error)
      setProfile(null)
      return
    }

    if (data) {
      setProfile(data as Profile)
      return
    }

    // Fallback: create profile if not exists
    const fallbackDisplayName =
      (typeof currentUser.user_metadata?.full_name === "string" && currentUser.user_metadata.full_name.trim()) ||
      (typeof currentUser.user_metadata?.name === "string" && currentUser.user_metadata.name.trim()) ||
      (typeof currentUser.email === "string" && currentUser.email.trim()) ||
      ""

    const fallbackAvatarUrl =
      (typeof currentUser.user_metadata?.avatar_url === "string" && currentUser.user_metadata.avatar_url.trim()) ||
      (typeof currentUser.user_metadata?.picture === "string" && currentUser.user_metadata.picture.trim()) ||
      null

    const { data: created } = await supabase
      .from("profiles")
      .upsert(
        {
          id: currentUser.id,
          email: currentUser.email ?? null,
          display_name: fallbackDisplayName || null,
          avatar_url: fallbackAvatarUrl,
        },
        { onConflict: "id" },
      )
      .select("id,email,display_name,avatar_url")
      .maybeSingle()

    setProfile((created as Profile) ?? null)
  }, [])

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    let isMounted = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) return
        setSession(data.session ?? null)
        setUser(data.session?.user ?? null)
        void refreshProfile(data.session?.user ?? null)
      })
      .finally(() => {
        if (!isMounted) return
        setIsLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      
      // Only refresh profile if user changed
      if (nextSession?.user?.id !== user?.id) {
         void refreshProfile(nextSession?.user ?? null)
      }
    })

    return () => {
      isMounted = false
      sub.subscription.unsubscribe()
    }
  }, [refreshProfile, user?.id])

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      isLoading,
      refreshProfile: async () => void refreshProfile(user),
      updateProfile: async (patch: { display_name?: string; avatar_url?: string }) => {
        if (!user) return
        const supabase = getSupabaseBrowserClient()
        await supabase.from("profiles").update(patch).eq("id", user.id)
        await refreshProfile(user)
      },
      signOut: async () => {
        const supabase = getSupabaseBrowserClient()
        await supabase.auth.signOut()
      },
    }),
    [session, user, profile, isLoading, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
