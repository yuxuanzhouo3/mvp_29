"use client"

import { useEffect, useState, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const processedRef = useRef(false)

  useEffect(() => {
    const code = searchParams.get("code")
    const state = searchParams.get("state")

    if (!code) {
      setStatus("error")
      toast({
        title: "登录失败",
        description: "未获取到微信授权代码",
        variant: "destructive",
      })
      // 延迟跳转回登录页
      setTimeout(() => router.replace("/login"), 2000)
      return
    }

    if (processedRef.current) return
    processedRef.current = true

    const login = async () => {
      try {
        const res = await fetch("/api/auth/wechat/android-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          throw new Error(data.error || "登录失败")
        }

        setStatus("success")
        toast({
          title: "登录成功",
          description: "欢迎回来",
        })

        // 跳转到首页
        router.replace("/")
      } catch (error) {
        setStatus("error")
        toast({
          title: "登录失败",
          description: error instanceof Error ? error.message : "未知错误",
          variant: "destructive",
        })
        setTimeout(() => router.replace("/login"), 2000)
      }
    }

    login()
  }, [searchParams, router, toast])

  return (
    <div className="text-center space-y-4">
      {status === "loading" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">正在处理微信登录...</p>
        </>
      )}
      {status === "success" && (
        <>
          <div className="h-10 w-10 mx-auto text-green-500">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-foreground font-medium">登录成功，正在跳转...</p>
        </>
      )}
      {status === "error" && (
        <>
          <div className="h-10 w-10 mx-auto text-destructive">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-destructive font-medium">登录失败</p>
        </>
      )}
    </div>
  )
}

export default function AndroidWechatCallbackPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <Suspense fallback={
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      }>
        <CallbackContent />
      </Suspense>
    </div>
  )
}
