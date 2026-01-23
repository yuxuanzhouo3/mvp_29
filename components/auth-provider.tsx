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

  const fetchProfile = useCallback(async (userId: string) => {
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
  }, [supabase])

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id)
    }
  }

  const updateProfile = async (patch: { display_name?: string; avatar_url?: string | null }) => {
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
      if (!user) return
      const { data, error } = await supabase.auth.updateUser({ data: patch })
      if (error) throw error
      if (data.user) setUser(data.user)
    },
    [supabase, user],
  )

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  useEffect(() => {
    // Domestic/Tencent Environment: Use CloudBase Auth (Anonymous)
    if (process.env.NEXT_PUBLIC_DEPLOY_TARGET === 'tencent') {
      const initCloudBaseAuth = async () => {
        try {
          const { getCloudBaseAuth } = await import('@/lib/cloudbase-client')
          const auth = getCloudBaseAuth()
          
          const loginState = await auth.getLoginState()
          let currentUser = loginState ? loginState.user : null
          
          if (!currentUser) {
            await auth.signInAnonymously()
            currentUser = auth.currentUser
          }

          if (currentUser) {
            // Adapt CloudBase user to Supabase-like User structure
            const adaptedUser: User = {
              id: currentUser.uid,
              app_metadata: {},
              user_metadata: {},
              aud: 'authenticated',
              created_at: new Date().toISOString(),
              email: undefined,
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
              email: null,
              display_name: 'Guest User',
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

    // If dummy client, skip auth check
    if (supabase.supabaseUrl === "https://placeholder.supabase.co") {
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
  }, [supabase, fetchProfile])

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
