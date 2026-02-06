"use client"

import { useEffect, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import {
  clearWxMpLoginParams,
  exchangeCodeForToken,
  parseWxMpLoginCallback,
} from "@/lib/wechat-mp"
import { useRouter } from "next/navigation"

export function WechatMiniProgramAuthHandler() {
  const { toast } = useToast()
  const router = useRouter()
  const processingRef = useRef(false)
  const isTencent = process.env.NEXT_PUBLIC_DEPLOY_TARGET === "tencent"

  useEffect(() => {
    if (!isTencent) return

    const handleMpLoginCallback = async () => {
      const callback = parseWxMpLoginCallback()
      if (!callback) return
      if (processingRef.current) return
      processingRef.current = true

      try {
        if (callback.token && callback.openid) {
          const res = await fetch("/api/auth/mp-callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: callback.token,
              openid: callback.openid,
              expiresIn: callback.expiresIn,
              nickName: callback.nickName,
              avatarUrl: callback.avatarUrl,
            }),
          })
          if (res.ok) {
            clearWxMpLoginParams()
            // Force a hard reload to ensure auth state is picked up
            window.location.reload()
            return
          }
        }
        if (callback.code) {
          const result = await exchangeCodeForToken(
            callback.code,
            callback.nickName,
            callback.avatarUrl
          )
          if (result.success) {
            clearWxMpLoginParams()
            window.location.reload()
            return
          }
        }
        clearWxMpLoginParams()
      } catch (error) {
        clearWxMpLoginParams()
        const message = error instanceof Error ? error.message : "微信登录失败"
        toast({ title: "微信登录失败", description: message, variant: "destructive" })
      } finally {
        processingRef.current = false
      }
    }

    void handleMpLoginCallback()
  }, [isTencent, toast])

  return null
}
