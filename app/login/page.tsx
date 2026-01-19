"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { useAuth } from "@/components/auth-provider"

export default function LoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const { user, isLoading } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [view, setView] = useState<"form" | "verify">("form")
  const [emailCode, setEmailCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isLoading) return
    if (user) router.replace("/")
  }, [isLoading, router, user])

  const formatAuthError = (e: unknown): { title: string; description: string; variant?: "destructive"; nextView?: "verify" } => {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "操作失败"
    const normalized = message.toLowerCase()
    const status = typeof (e as { status?: unknown } | null)?.status === "number" ? (e as { status: number }).status : undefined

    if (normalized.includes("invalid login credentials") || normalized.includes("invalid credentials")) {
      return { title: "账号或密码错误", description: "请检查邮箱和密码后重试。", variant: "destructive" }
    }

    if (/not confirmed|confirm(ed)?|验证邮箱/i.test(message) || normalized.includes("email not confirmed")) {
      return { title: "邮箱未验证", description: "请填写邮件中的验证码完成验证后再登录。", nextView: "verify" }
    }

    if (normalized.includes("user already registered") || normalized.includes("already registered")) {
      return { title: "该邮箱已注册", description: "请直接登录，或稍后使用找回密码。", variant: "destructive" }
    }

    if (normalized.includes("too many requests") || status === 429) {
      return { title: "请求过于频繁", description: "请稍后再试。", variant: "destructive" }
    }

    if (normalized.includes("network") || normalized.includes("fetch failed")) {
      return { title: "网络异常", description: "请检查网络连接后重试。", variant: "destructive" }
    }

    return { title: "登录失败", description: message, variant: "destructive" }
  }

  const handleEmailLogin = async () => {
    setIsSubmitting(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
      router.replace("/")
    } catch (e) {
      const formatted = formatAuthError(e)
      if (formatted.nextView === "verify") {
        setView("verify")
      }
      toast({
        title: formatted.title,
        description: formatted.description,
        variant: formatted.variant,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEmailSignup = async () => {
    setIsSubmitting(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })
      if (error) throw error

      if (data.session) {
        router.replace("/")
        return
      }

      toast({
        title: "注册成功",
        description: "验证码已发送到邮箱，请输入验证码完成注册并登录。",
      })
      setView("verify")
    } catch (e) {
      const message = e instanceof Error ? e.message : "注册失败"
      toast({ title: "注册失败", description: message, variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerifySignupCode = async () => {
    setIsSubmitting(true)
    try {
      const trimmedEmail = email.trim()
      const trimmedCode = emailCode.trim()
      const { data, error } = await supabase.auth.verifyOtp({
        email: trimmedEmail,
        token: trimmedCode,
        type: "signup",
      })
      if (error) throw error

      if (data.session) {
        toast({ title: "验证成功", description: "已完成注册并登录。" })
        router.replace("/")
        return
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })
      if (loginError) throw loginError
      toast({ title: "验证成功", description: "已完成注册并登录。" })
      router.replace("/")
    } catch (e) {
      const formatted = formatAuthError(e)
      toast({
        title: formatted.title === "登录失败" ? "验证失败" : formatted.title,
        description: formatted.description,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendSignupCode = async () => {
    setIsSubmitting(true)
    try {
      const trimmedEmail = email.trim()
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: trimmedEmail,
      })
      if (error) throw error
      toast({ title: "已重新发送", description: "请查收邮箱中的验证码。" })
    } catch (e) {
      const message = e instanceof Error ? e.message : "发送失败"
      toast({ title: "发送失败", description: message, variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogleLogin = async () => {
    setIsSubmitting(true)
    try {
      const redirectTo = `${window.location.origin}/auth/callback`
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      })
      if (error) throw error
      if (data?.url) {
        window.location.assign(data.url)
        return
      }
      throw new Error("无法获取 Google 授权链接")
    } catch (e) {
      const message = e instanceof Error ? e.message : "Google 登录失败"
      toast({ title: "登录失败", description: message, variant: "destructive" })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">登录 / 注册</CardTitle>
          <CardDescription>{view === "verify" ? "输入邮箱验证码完成注册并登录" : "使用邮箱或 Google 账号继续"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={view === "verify" ? "new-password" : "current-password"}
                required
              />
            </div>

            {view === "verify" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="emailCode">邮箱验证码</Label>
                  <Input
                    id="emailCode"
                    inputMode="numeric"
                    placeholder="请输入邮件中的验证码"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Button onClick={handleVerifySignupCode} disabled={isSubmitting || !email.trim() || !emailCode.trim()}>
                    验证并登录
                  </Button>
                  <Button variant="outline" onClick={handleResendSignupCode} disabled={isSubmitting || !email.trim()}>
                    重新发送
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setView("form")}
                  disabled={isSubmitting}
                >
                  返回登录 / 注册
                </Button>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={handleEmailLogin} disabled={isSubmitting || !email.trim() || !password}>
                  邮箱登录
                </Button>
                <Button variant="outline" onClick={handleEmailSignup} disabled={isSubmitting || !email.trim() || !password}>
                  邮箱注册
                </Button>
              </div>
            )}
          </div>

          {view === "form" ? (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">或</span>
                </div>
              </div>

              <Button variant="outline" className="w-full bg-transparent" onClick={handleGoogleLogin} disabled={isSubmitting}>
                使用 Google 登录
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
