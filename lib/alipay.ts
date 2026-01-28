import { AlipaySdk } from "alipay-sdk"

function resolveEnvValue(key: string, tencentKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const target = String(env.DEPLOY_TARGET ?? env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent") return env[tencentKey] ?? env[key]
  return env[key] ?? env[tencentKey]
}

export function getAlipaySdk() {
  const appId = resolveEnvValue("ALIPAY_APP_ID", "TENCENT_ALIPAY_APP_ID")
  const privateKey = resolveEnvValue("ALIPAY_APP_PRIVATE_KEY", "TENCENT_ALIPAY_APP_PRIVATE_KEY")
  const alipayPublicKey = resolveEnvValue("ALIPAY_PUBLIC_KEY", "TENCENT_ALIPAY_PUBLIC_KEY")
  const gateway =
    resolveEnvValue("ALIPAY_GATEWAY", "TENCENT_ALIPAY_GATEWAY") || "https://openapi.alipay.com/gateway.do"

  if (!appId || !privateKey || !alipayPublicKey) {
    throw new Error("Missing Alipay config")
  }

  return new AlipaySdk({
    appId,
    privateKey,
    alipayPublicKey,
    gateway,
    signType: "RSA2",
  })
}

export function getAlipayNotifyUrl() {
  return (
    resolveEnvValue("ALIPAY_NOTIFY_URL", "TENCENT_ALIPAY_NOTIFY_URL") ||
    resolveEnvValue("ALIPAY_NOTIFY_URL", "TENCENT_ALIPAY_NOTIFY_URL")
  )
}

export function getAlipayReturnUrl() {
  return (
    resolveEnvValue("ALIPAY_RETURN_URL", "TENCENT_ALIPAY_RETURN_URL") ||
    resolveEnvValue("ALIPAY_RETURN_URL", "TENCENT_ALIPAY_RETURN_URL")
  )
}
