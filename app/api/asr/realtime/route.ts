import { createHmac, randomUUID } from "crypto"
import process from "process"

export const runtime = "nodejs"

function resolveEnvValue(key: string, tencentKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const target = String(env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent") return env[tencentKey] ?? env[key]
  return env[key] ?? env[tencentKey]
}

function buildSignature(params: Record<string, string | number>, appId: string, secretKey: string): string {
  const keys = Object.keys(params).sort()
  const query = keys.map((key) => `${key}=${params[key]}`).join("&")
  const source = `asr.cloud.tencent.com/asr/v2/${appId}?${query}`
  const signature = createHmac("sha1", secretKey).update(source).digest("base64")
  return `wss://${source}&signature=${encodeURIComponent(signature)}`
}

export async function GET(req: Request) {
  try {
    let appId = resolveEnvValue("ASR_APP_ID", "TENCENT_ASR_APP_ID")
    const secretId = resolveEnvValue("ASR_SECRET_ID", "TENCENT_ASR_SECRET_ID")
    const secretKey = resolveEnvValue("ASR_SECRET_KEY", "TENCENT_ASR_SECRET_KEY")

    // Update AppID to the correct one if missing or using the old Account ID
    if (!appId || appId === "100044870853") {
      appId = "1385410663";
    }

    if (!appId || !secretId || !secretKey) {
      return Response.json({ error: "Missing Tencent ASR credentials" }, { status: 500 })
    }

    const url = new URL(req.url)
    const engineModelType = url.searchParams.get("engineModelType")?.trim() || "16k_zh"
    const voiceFormatRaw = Number(url.searchParams.get("voiceFormat") ?? 10)
    const needVadRaw = Number(url.searchParams.get("needVad") ?? 1)
    const voiceFormat = Number.isFinite(voiceFormatRaw) ? voiceFormatRaw : 10
    const needVad = Number.isFinite(needVadRaw) ? needVadRaw : 1

    const timestamp = Math.floor(Date.now() / 1000)
    const expired = timestamp + 60 * 60
    const nonce = Math.floor(Math.random() * 10 ** 10)
    const voiceId = randomUUID()

    const params = {
      engine_model_type: engineModelType,
      expired,
      needvad: needVad,
      nonce,
      secretid: secretId,
      timestamp,
      voice_format: voiceFormat,
      voice_id: voiceId,
    }

    const signedUrl = buildSignature(params, appId, secretKey)

    return Response.json({
      url: signedUrl,
      voiceId,
      timestamp,
      expired,
      engineModelType,
      voiceFormat,
    })
  } catch (error) {
    console.error("[v0] Tencent realtime ASR error:", error)
    return Response.json({ error: "Failed to create realtime ASR signature" }, { status: 500 })
  }
}
