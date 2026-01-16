"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    const code = searchParams.get("code")

    const run = async () => {
      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
      } else {
        await supabase.auth.getSession()
      }
      router.replace("/")
    }

    void run()
  }, [router, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-sm text-muted-foreground">正在完成登录...</div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-sm text-muted-foreground">正在完成登录...</div>
        </div>
      }
    >
      <CallbackInner />
    </Suspense>
  )
}
