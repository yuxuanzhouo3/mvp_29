import { Buffer } from "buffer"
import { createHash, createHmac } from "crypto"
import process from "process"

export const maxDuration = 30
export const runtime = "nodejs"

function resolveEnvValue(key: string, tencentKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const target = String(env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent") return env[tencentKey] ?? env[key]
  return env[key] ?? env[tencentKey]
}

function getTencentErrorMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const response = record.Response as Record<string, unknown> | undefined
  const error = response?.Error as Record<string, unknown> | undefined
  return typeof error?.Message === "string" ? String(error.Message) : null
}

function toTencentAsrEngine(language: string): string | undefined {
  const normalized = String(language || "").trim().toLowerCase()
  if (normalized === "中文" || normalized === "汉语" || normalized === "普通话") return "16k_zh"
  if (normalized === "英语" || normalized === "英文") return "16k_en"
  if (normalized === "日语" || normalized === "日文") return "16k_ja"
  if (normalized === "韩语" || normalized === "韩文") return "16k_ko"
  if (normalized === "法语" || normalized === "法文") return "16k_fr"
  if (normalized === "德语" || normalized === "德文") return "16k_de"
  if (normalized === "西班牙语" || normalized === "西班牙文") return "16k_es"
  if (normalized === "葡萄牙语" || normalized === "葡萄牙文") return "16k_pt"

  if (normalized.startsWith("zh")) return "16k_zh"
  if (normalized.startsWith("en")) return "16k_en"
  if (normalized.startsWith("ja")) return "16k_ja"
  if (normalized.startsWith("ko")) return "16k_ko"
  if (normalized.startsWith("fr")) return "16k_fr"
  if (normalized.startsWith("de")) return "16k_de"
  if (normalized.startsWith("es")) return "16k_es"
  if (normalized.startsWith("pt")) return "16k_pt"
  return undefined
}

function extractTextFromTencentResponse(value: unknown): string {
  if (typeof value !== "object" || value === null) return ""
  const record = value as Record<string, unknown>
  const response = record.Response as Record<string, unknown> | undefined
  const result = response?.Result
  if (typeof result === "string" && result.trim().length > 0) return result.trim()
  return ""
}

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload).digest("hex")
}

function hmacSha256(key: string | Buffer, msg: string): Buffer {
  return createHmac("sha256", key).update(msg).digest()
}

function signTencentRequest(options: {
  secretId: string
  secretKey: string
  service: string
  host: string
  action: string
  version: string
  region: string
  timestamp: number
  payload: string
}) {
  const { secretId, secretKey, service, host, action, version, region, timestamp, payload } = options
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = "content-type;host"
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join("\n")
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n")
  const secretDate = hmacSha256(`TC3${secretKey}`, date)
  const secretService = hmacSha256(secretDate, service)
  const secretSigning = hmacSha256(secretService, "tc3_request")
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex")
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  return {
    authorization,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Region": region,
      "X-TC-Timestamp": String(timestamp),
    },
  }
}

function resolveVoiceFormat(mediaType: string): string {
  const normalized = String(mediaType || "").toLowerCase()
  if (normalized.includes("wav")) return "wav"
  if (normalized.includes("mp3") || normalized.includes("mpeg")) return "mp3"
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a"
  if (normalized.includes("ogg")) return "ogg-opus"
  if (normalized.includes("aac")) return "aac"
  if (normalized.includes("webm")) return "ogg-opus"
  return "ogg-opus"
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const audioFile = formData.get("audio") as File
    const language = formData.get("language") as string

    if (!audioFile) {
      return Response.json({ error: "No audio file provided" }, { status: 400 })
    }
    if (audioFile.size < 1024) {
      return Response.json({ error: "Audio is empty" }, { status: 400 })
    }

    const secretId = resolveEnvValue("ASR_SECRET_ID", "TENCENT_ASR_SECRET_ID")
    const secretKey = resolveEnvValue("ASR_SECRET_KEY", "TENCENT_ASR_SECRET_KEY")
    if (!secretId || !secretKey) {
      return Response.json({ error: "Missing Tencent ASR credentials" }, { status: 500 })
    }

    const arrayBuffer = await audioFile.arrayBuffer()
    if (arrayBuffer.byteLength < 1024) {
      return Response.json({ error: "Audio is empty" }, { status: 400 })
    }
    const base64Audio = Buffer.from(arrayBuffer).toString("base64")
    const mediaType = audioFile.type || "audio/webm"
    const audioFormat = resolveVoiceFormat(mediaType)
    const engineFromEnv = resolveEnvValue("ASR_ENGINE_MODEL", "TENCENT_ASR_ENGINE_MODEL")
    const engine = engineFromEnv?.trim() || toTencentAsrEngine(language) || "16k_zh"
    const region = resolveEnvValue("ASR_REGION", "TENCENT_ASR_REGION") || "ap-shanghai"
    const projectId = Number(resolveEnvValue("ASR_PROJECT_ID", "TENCENT_ASR_PROJECT_ID") || 0)
    const subServiceType = Number(resolveEnvValue("ASR_SUB_SERVICE_TYPE", "TENCENT_ASR_SUB_SERVICE_TYPE") || 2)
    const usrAudioKey = resolveEnvValue("ASR_USR_AUDIO_KEY", "TENCENT_ASR_USR_AUDIO_KEY") || `audio-${Date.now()}`
    const payload = JSON.stringify({
      ProjectId: Number.isFinite(projectId) ? projectId : 0,
      SubServiceType: Number.isFinite(subServiceType) ? subServiceType : 2,
      EngSerViceType: engine,
      SourceType: 1,
      VoiceFormat: audioFormat,
      Data: base64Audio,
      DataLen: arrayBuffer.byteLength,
      UsrAudioKey: usrAudioKey,
    })
    const host = "asr.tencentcloudapi.com"
    const action = "SentenceRecognition"
    const version = "2019-06-14"
    const timestamp = Math.floor(Date.now() / 1000)
    const { authorization, headers } = signTencentRequest({
      secretId,
      secretKey,
      service: "asr",
      host,
      action,
      version,
      region,
      timestamp,
      payload,
    })
    const response = await fetch(`https://${host}/`, {
      method: "POST",
      headers: {
        ...headers,
        Authorization: authorization,
      },
      body: payload,
    })

    const data = (await response.json().catch(() => null)) as unknown
    const message = getTencentErrorMessage(data)
    if (message) {
      const normalized = message.toLowerCase()
      if (normalized.includes("audio data empty") || normalized.includes("audio decoding failed")) {
        return Response.json({ text: "" })
      }
      return Response.json({ error: message }, { status: 500 })
    }
    if (!response.ok) {
      return Response.json({ error: `Tencent ASR failed (${response.status})` }, { status: 500 })
    }

    const text = extractTextFromTencentResponse(data)
    if (text.trim().length === 0) {
      return Response.json({ text: "" })
    }

    return Response.json({ text: text.trim() })
  } catch (error) {
    console.error("[v0] Transcription error:", error)
    return Response.json({ error: "Failed to transcribe audio" }, { status: 500 })
  }
}
