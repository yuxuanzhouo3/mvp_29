interface WxMiniProgram {
  postMessage?: (data: unknown) => void
  navigateTo?: (options: { url: string }) => void
  navigateBack?: (options?: { delta?: number }) => void
  getEnv?: (callback: (res: { miniprogram: boolean }) => void) => void
}

declare global {
  interface Window {
    wx?: { miniProgram?: WxMiniProgram }
    __wxjs_environment?: string
  }
}

export function isMiniProgram(): boolean {
  if (typeof window === "undefined") return false
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("miniprogram")) return true
  if (window.__wxjs_environment === "miniprogram") return true
  const params = new URLSearchParams(window.location.search)
  if (params.get("_wxjs_environment") === "miniprogram") return true
  return false
}

export function getWxMiniProgram(): WxMiniProgram | null {
  if (typeof window === "undefined") return null
  const wxObj = window.wx
  if (!wxObj || typeof wxObj !== "object") return null
  const mp = wxObj.miniProgram
  if (!mp || typeof mp !== "object") return null
  return mp
}

export function waitForWxSDK(timeout = 3000): Promise<WxMiniProgram | null> {
  return new Promise((resolve) => {
    const mp = getWxMiniProgram()
    if (mp) {
      resolve(mp)
      return
    }
    const startTime = Date.now()
    const checkInterval = setInterval(() => {
      const mp = getWxMiniProgram()
      if (mp) {
        clearInterval(checkInterval)
        resolve(mp)
        return
      }
      if (Date.now() - startTime >= timeout) {
        clearInterval(checkInterval)
        resolve(null)
      }
    }, 100)
  })
}

export interface WxMpLoginCallback {
  token: string | null
  openid: string | null
  expiresIn: string | null
  nickName: string | null
  avatarUrl: string | null
  code: string | null
}

const safeDecode = (value: string | null): string | null => {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseWxMpLoginCallback(): WxMpLoginCallback | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const token = params.get("token")
  const openid = params.get("openid")
  const code = params.get("mpCode")
  if (!token && !openid && !code) return null
  return {
    token,
    openid,
    expiresIn: params.get("expiresIn"),
    nickName: safeDecode(params.get("mpNickName")),
    avatarUrl: safeDecode(params.get("mpAvatarUrl")),
    code,
  }
}

export function clearWxMpLoginParams(): void {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  const paramsToRemove = [
    "token",
    "openid",
    "expiresIn",
    "mpCode",
    "mpNickName",
    "mpAvatarUrl",
    "mpProfileTs",
    "mpReadyTs",
    "mpPongTs",
  ]
  paramsToRemove.forEach((key) => url.searchParams.delete(key))
  window.history.replaceState({}, "", url.toString())
}

export async function requestWxMpLogin(returnUrl?: string): Promise<boolean> {
  const mp = await waitForWxSDK()
  if (!mp) {
    return false
  }
  const currentUrl = returnUrl || window.location.href
  if (typeof mp.navigateTo === "function") {
    const loginUrl = `/pages/webshell/login?returnUrl=${encodeURIComponent(currentUrl)}`
    mp.navigateTo({ url: loginUrl })
    return true
  }
  if (typeof mp.postMessage === "function") {
    mp.postMessage({ data: { type: "REQUEST_WX_LOGIN", returnUrl: currentUrl } })
    if (typeof mp.navigateBack === "function") {
      mp.navigateBack({ delta: 1 })
    }
    return true
  }
  return false
}

export async function exchangeCodeForToken(
  code: string,
  nickName?: string | null,
  avatarUrl?: string | null
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const response = await fetch("/api/wxlogin/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code, nickName, avatarUrl }),
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, error: data.message || data.error || "登录失败" }
    }
    return { success: true, token: data.token }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "网络错误" }
  }
}
