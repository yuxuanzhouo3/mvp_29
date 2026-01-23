import { Buffer } from "buffer"
import process from "process"

export const maxDuration = 30
export const runtime = "nodejs"

function resolveEnvValue(key: string, tencentKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const target = String(env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent") return env[tencentKey] ?? env[key]
  return env[key] ?? env[tencentKey]
}

function getDashScopeErrorMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  return typeof record.message === "string" ? record.message : null
}

function toDashScopeAsrLanguage(language: string): string | undefined {
  const normalized = String(language || "").trim().toLowerCase()
  if (normalized === "中文" || normalized === "汉语" || normalized === "普通话") return "zh"
  if (normalized === "英语" || normalized === "英文") return "en"
  if (normalized === "日语" || normalized === "日文") return "ja"
  if (normalized === "韩语" || normalized === "韩文") return "ko"
  if (normalized === "法语" || normalized === "法文") return "fr"
  if (normalized === "德语" || normalized === "德文") return "de"
  if (normalized === "西班牙语" || normalized === "西班牙文") return "es"
  if (normalized === "葡萄牙语" || normalized === "葡萄牙文") return "pt"

  if (normalized.startsWith("zh")) return "zh"
  if (normalized.startsWith("en")) return "en"
  if (normalized.startsWith("ja")) return "ja"
  if (normalized.startsWith("ko")) return "ko"
  if (normalized.startsWith("fr")) return "fr"
  if (normalized.startsWith("de")) return "de"
  if (normalized.startsWith("es")) return "es"
  if (normalized.startsWith("pt")) return "pt"
  if (/^[a-z]{2}$/.test(normalized)) return normalized
  return undefined
}

function extractTextFromDashScopeResponse(value: unknown): string {
  if (typeof value !== "object" || value === null) return ""
  const record = value as Record<string, unknown>

  const output = record.output as Record<string, unknown> | undefined
  const choices = (output?.choices as Array<unknown> | undefined) ?? []
  const firstChoice = (choices[0] as Record<string, unknown> | undefined) ?? undefined
  const message = (firstChoice?.message as Record<string, unknown> | undefined) ?? undefined
  const content = (message?.content as Array<unknown> | undefined) ?? []

  for (const part of content) {
    if (typeof part !== "object" || part === null) continue
    const partRecord = part as Record<string, unknown>
    const text = partRecord.text
    if (typeof text === "string" && text.trim().length > 0) return text.trim()
  }

  const outputText = output?.text
  if (typeof outputText === "string" && outputText.trim().length > 0) return outputText.trim()

  const directText = record.text
  if (typeof directText === "string" && directText.trim().length > 0) return directText.trim()

  return ""
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const audioFile = formData.get("audio") as File
    const language = formData.get("language") as string

    if (!audioFile) {
      return Response.json({ error: "No audio file provided" }, { status: 400 })
    }

    const apiKey = resolveEnvValue("DASHSCOPE_API_KEY", "TENCENT_DASHSCOPE_API_KEY")
    if (!apiKey) {
      return Response.json({ error: "Missing DASHSCOPE_API_KEY" }, { status: 500 })
    }

    const envModel =
      resolveEnvValue("DASHSCOPE_ASR_MODEL", "TENCENT_DASHSCOPE_ASR_MODEL") || "qwen3-asr-flash"
    const model = envModel.includes("realtime") ? "qwen3-asr-flash" : envModel

    const arrayBuffer = await audioFile.arrayBuffer()
    const base64Audio = Buffer.from(arrayBuffer).toString("base64")
    const mediaType = audioFile.type || "audio/webm"
    const audioUrl = `data:${mediaType};base64,${base64Audio}`
    const asrLanguage = toDashScopeAsrLanguage(language)

    const endpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-OssResourceResolve": "enable",
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: "system",
              content: [{ text: "" }],
            },
            {
              role: "user",
              content: [{ audio: audioUrl }],
            },
          ],
        },
        parameters: {
          result_format: "message",
          asr_options: {
            ...(asrLanguage ? { language: asrLanguage } : {}),
            enable_itn: true,
          },
        },
      }),
    })

    const data = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      const message = getDashScopeErrorMessage(data) || `DashScope ASR failed (${response.status})`
      return Response.json({ error: message }, { status: 500 })
    }

    const text = extractTextFromDashScopeResponse(data)
    if (text.trim().length === 0) {
      return Response.json({ error: "Empty transcription result" }, { status: 500 })
    }

    return Response.json({ text: text.trim() })
  } catch (error) {
    console.error("[v0] Transcription error:", error)
    return Response.json({ error: "Failed to transcribe audio" }, { status: 500 })
  }
}
