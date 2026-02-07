"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

export default function AdminLoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { user } = useAuth()
  const isTencent = process.env.NEXT_PUBLIC_DEPLOY_TARGET === "tencent"
  const tencentLogoutKey = "tencent:auth:logged_out"

  const clearTencentLoggedOut = () => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.removeItem(tencentLogoutKey)
    } catch {
      return
    }
  }

  // 如果已登录，重定向到后台
  if (user) {
    router.push("/admin")
    // return null // 不要 return null，可能会导致 hydration 错误或闪烁，让它继续渲染但 router.push 会处理跳转
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)

    try {
      const trimmedEmail = email.trim()
      if (isTencent) {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, password }),
        })
        const data = await res.json()
        if (!res.ok || !data.success) {
          throw new Error(data.error || "登录失败")
        }
        clearTencentLoggedOut()
        toast.success("登录成功")
        window.location.assign("/admin")
        return
      }

      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (error) {
        throw error
      }

      toast.success("登录成功")
      router.push("/admin")
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "登录失败")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-10 sm:py-16">
      <Card className="w-full max-w-lg shadow-sm">
        <CardHeader className="space-y-2 pb-5">
          <CardTitle className="text-3xl font-bold tracking-tight">后台管理登录</CardTitle>
          <CardDescription>
            请输入您的账号和密码
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
                required
              />
            </div>
          </CardContent>
          <CardFooter className="pt-2">
            <Button className="h-11 w-full" type="submit" disabled={isLoading}>
              {isLoading ? "登录中..." : "登录"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
