'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
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
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const isTencent = process.env.NEXT_PUBLIC_DEPLOY_TARGET === 'tencent'

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
      const { getCloudBaseAuth } = await import('@/lib/cloudbase-client')
      const auth = getCloudBaseAuth()
      await auth.signOut()
      setSession(null)
      setUser(null)
      setProfile(null)
      return
    }
    await supabase.auth.signOut()
  }

  useEffect(() => {
    // Domestic/Tencent Environment: Use CloudBase Auth (Anonymous)
    if (isTencent) {
      const initCloudBaseAuth = async () => {
        try {
          const { getCloudBaseAuth } = await import('@/lib/cloudbase-client')
          const auth = getCloudBaseAuth()
          if (typeof auth.setPersistence === "function") {
            await auth.setPersistence("local")
          }
          
          const loginState = await auth.getLoginState()
          let currentUser = loginState ? loginState.user : null
          
          if (!currentUser) {
            await auth.signInAnonymously()
            currentUser = auth.currentUser
          }

          if (currentUser) {
            // Adapt CloudBase user to Supabase-like User structure
            const email = (currentUser as { email?: string }).email ?? null
            const displayName =
              (currentUser as { nickName?: string }).nickName ??
              (currentUser as { username?: string }).username ??
              (email ? email.split("@")[0] : 'Guest User')
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
            
            // Mock profile for guest user
            setProfile({
              id: currentUser.uid,
              email: email ?? null,
              display_name: displayName,
              avatar_url: null
            })
          }
        } catch (err) {
          console.error("CloudBase auth error:", err)
        } finally {
          setIsLoading(false)
        }
      }
      
      initCloudBaseAuth()
      return
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
