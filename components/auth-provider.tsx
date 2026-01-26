'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { type Session, type User, type AuthChangeEvent } from '@supabase/supabase-js'

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
  updateProfile: (patch: { display_name?: string; avatar_url?: string | null }) => Promise<void>
  updateUserMetadata: (patch: Record<string, unknown>) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const tencentAuthSnapshotRef = useRef<{ uid: string | null; email: string | null; displayName: string | null }>({
    uid: null,
    email: null,
    displayName: null
  })
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const isTencent = process.env.NEXT_PUBLIC_DEPLOY_TARGET === 'tencent'
  const tencentLogoutKey = 'tencent:auth:logged_out'
  const getTencentLoggedOut = () => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(tencentLogoutKey) === '1'
    } catch {
      return false
    }
  }
  const setTencentLoggedOut = (value: boolean) => {
    if (typeof window === 'undefined') return
    try {
      if (value) {
        window.localStorage.setItem(tencentLogoutKey, '1')
      } else {
        window.localStorage.removeItem(tencentLogoutKey)
      }
    } catch {
      return
    }
  }

  const fetchProfile = useCallback(async (userId: string) => {
    if (isTencent) return
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error
      setProfile(data)
    } catch (error) {
      console.error('Error fetching profile:', error)
      setProfile(null)
    }
  }, [isTencent, supabase])

  const refreshProfile = async () => {
    if (isTencent) return
    if (user) {
      await fetchProfile(user.id)
    }
  }

  const updateProfile = async (patch: { display_name?: string; avatar_url?: string | null }) => {
    if (isTencent) return
    if (!user) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)

      if (error) throw error
      await refreshProfile()
    } catch (error) {
      console.error('Error updating profile:', error)
      throw error
    }
  }

  const updateUserMetadata = useCallback(
    async (patch: Record<string, unknown>) => {
      if (isTencent) return
      if (!user) return
      const { data, error } = await supabase.auth.updateUser({ data: patch })
      if (error) throw error
      if (data.user) setUser(data.user)
    },
    [isTencent, supabase, user],
  )

  const signOut = async () => {
    if (isTencent) {
      try {
        const { getCloudBaseAuth } = await import('@/lib/cloudbase-client')
        const auth = getCloudBaseAuth()
        setTencentLoggedOut(true)
        await Promise.race([
          auth.signOut(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sign out timeout')), 3000))
        ])
      } catch (err) {
        console.warn("CloudBase signOut error or timeout:", err)
      } finally {
        setSession(null)
        setUser(null)
        setProfile(null)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return
    }
    await supabase.auth.signOut()
  }

  useEffect(() => {
    // Domestic/Tencent Environment: Use CloudBase Auth (Anonymous)
    if (isTencent) {
      let cancelled = false
      const initCloudBaseAuth = async () => {
        try {
          const { getCloudBaseAuth } = await import('@/lib/cloudbase-client')
          const auth = getCloudBaseAuth()
          if (typeof auth.setPersistence === "function") {
            await auth.setPersistence("local")
          }
          const applyCurrentUser = (currentUser: { uid: string } | null) => {
            if (cancelled) return
            const rawEmail = currentUser ? (currentUser as { email?: string }).email ?? null : null
            const email = typeof rawEmail === 'string' ? rawEmail.trim() : null
            if (!currentUser || !email) {
              const prev = tencentAuthSnapshotRef.current
              if (prev.uid === null && prev.email === null && prev.displayName === null) return
              tencentAuthSnapshotRef.current = { uid: null, email: null, displayName: null }
              setUser(null)
              setSession(null)
              setProfile(null)
              return
            }
            const displayName =
              (currentUser as { nickName?: string }).nickName ??
              (currentUser as { username?: string }).username ??
              (email ? email.split("@")[0] : 'Guest User')
            const prev = tencentAuthSnapshotRef.current
            if (prev.uid === currentUser.uid && prev.email === email && prev.displayName === displayName) return
            tencentAuthSnapshotRef.current = { uid: currentUser.uid, email, displayName }
            const adaptedUser: User = {
              id: currentUser.uid,
              app_metadata: {},
              user_metadata: {},
              aud: 'authenticated',
              created_at: new Date().toISOString(),
              email: email ?? undefined,
              phone: undefined,
              confirmed_at: undefined,
              last_sign_in_at: undefined,
              role: undefined,
              updated_at: undefined,
              factors: undefined
            }
            setUser(adaptedUser)
            setSession({
              access_token: 'mock_token_cloudbase',
              token_type: 'bearer',
              expires_in: 3600,
              refresh_token: 'mock_refresh_cloudbase',
              user: adaptedUser
            })
            setProfile({
              id: currentUser.uid,
              email: email ?? null,
              display_name: displayName,
              avatar_url: null
            })
          }

          const refreshLoginState = async () => {
            if (refreshInFlightRef.current) return refreshInFlightRef.current
            refreshInFlightRef.current = (async () => {
              const runWithTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
                let timeoutId: ReturnType<typeof setTimeout> | null = null
                try {
                  return await Promise.race([
                    promise,
                    new Promise<T>((_, reject) => {
                      timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs)
                    })
                  ])
                } finally {
                  if (timeoutId) clearTimeout(timeoutId)
                }
              }
              try {
                const loginState = await runWithTimeout(auth.getLoginState(), 3000)
                let currentUser: { uid: string } | null = null
                if (loginState && typeof loginState === "object" && "user" in loginState) {
                  currentUser = (loginState as { user?: { uid: string } | null }).user ?? null
                }
                const isLoggedOut = getTencentLoggedOut()
                if (isLoggedOut) {
                  currentUser = null
                }
                applyCurrentUser(currentUser)
              } catch (err) {
                console.error("CloudBase auth state refresh failed:", err)
                applyCurrentUser(null)
              } finally {
                refreshInFlightRef.current = null
              }
            })()
            return refreshInFlightRef.current
          }

          await refreshLoginState()

          if (typeof auth.onLoginStateChanged === "function") {
            auth.onLoginStateChanged((loginState: unknown) => {
              if (cancelled) return
              if (loginState && typeof loginState === "object" && "user" in loginState) {
                const state = loginState as { user?: { uid: string } | null }
                applyCurrentUser(state.user ?? null)
                return
              }
              if (getTencentLoggedOut()) {
                applyCurrentUser(null)
                return
              }
              void refreshLoginState()
            }).catch((e: unknown) => console.error("Failed to register login state listener:", e))
          }
        } catch (err) {
          console.error("CloudBase auth error:", err)
        } finally {
          if (!cancelled) {
            setIsLoading(false)
          }
        }
      }

      initCloudBaseAuth()
      return () => {
        cancelled = true
      }
    }

    const hasSupabasePublic =
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
      )
    if (!hasSupabasePublic) {
      setIsLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      }
      setIsLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
      }
      setIsLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [isTencent, supabase, fetchProfile])

  return (
    <AuthContext.Provider value={{
      session,
      user,
      profile,
      isLoading,
      refreshProfile,
      updateProfile,
      updateUserMetadata,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
