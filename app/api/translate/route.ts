import { generateText } from "ai"
import { mistral } from "@ai-sdk/mistral"
import { createOpenAI } from "@ai-sdk/openai"
import { type NextRequest, NextResponse } from "next/server"
import { apiRateLimit } from "@/lib/rate-limit"

export const maxDuration = 30

function sanitizeChineseTranslation(text: string): string {
  let out = text

  const labelMatch = out.match(/^(.*?)(?:\s*(?:翻译|译文|translation)\s*[:：].*)$/i)
  if (labelMatch?.[1]) out = labelMatch[1]

  const removeRomanizationParens = (value: string) => {
    return value
      .replaceAll(/（[^）]*[A-Za-zÀ-ÿ][^）]*）/g, "")
      .replaceAll(/\([^)]*[A-Za-zÀ-ÿ][^)]*\)/g, "")
  }
  out = removeRomanizationParens(out)

  return out.replaceAll(/\s+/g, " ").trim()
}

function sanitizeTranslatedText(text: string, targetLabel: string): string {
  const cleaned = text.trim()
  if (!cleaned) return cleaned
  if (targetLabel === "Chinese") return sanitizeChineseTranslation(cleaned)
  return cleaned
}

function resolveEnvValue(primaryKey: string, fallbackKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  return env[primaryKey] ?? env[fallbackKey]
}

function normalizeApiKey(value: string | undefined): string {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return ""
  const lower = raw.toLowerCase()
  if (lower === "your-api-key" || lower === "your_api_key" || lower === "changeme") return ""
  return raw
}

function resolveMistralTranslateModelId(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return "open-mistral-7b"

  const lower = raw.toLowerCase()
  if (lower === "mistral-7b-instruct-v0.3" || lower === "mistral 7b instruct v0.3") return "open-mistral-7b"
  if (lower === "open-mistral-7b") return "open-mistral-7b"
  if (lower === "mistral-large-latest") return "mistral-large-latest"
  if (lower === "mistral-small-latest") return "mistral-small-latest"
  if (lower === "mistral-medium-latest") return "mistral-medium-latest"

  return raw
}

function normalizeLanguageLabel(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return ""

  const normalized = raw.toLowerCase().replaceAll("_", "-")
  const primary = normalized.split("-")[0] ?? normalized

  if (primary === "zh" || raw === "中文" || raw === "汉语" || raw === "普通话") return "Chinese"
  if (primary === "en" || raw === "英语" || raw === "英文") return "English"
  if (primary === "ja" || raw === "日语" || raw === "日文") return "Japanese"
  if (primary === "ko" || raw === "韩语" || raw === "韩文") return "Korean"
  if (primary === "fr" || raw === "法语" || raw === "法文") return "French"
  if (primary === "de" || raw === "德语" || raw === "德文") return "German"
  if (primary === "es" || raw === "西班牙语" || raw === "西班牙文") return "Spanish"
  if (primary === "pt" || raw === "葡萄牙语" || raw === "葡萄牙文") return "Portuguese"

  return raw
}

export async function POST(req: NextRequest) {
  // 应用限流
  const rateLimitCheck = await apiRateLimit()(req)
  if (rateLimitCheck) {
    return rateLimitCheck
  }

  try {
    const deployTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
    const isTencent = deployTarget === "tencent"
    const { text, sourceLanguage, targetLanguage } = await req.json()

    if (typeof text !== "string" || text.trim().length === 0) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    const sourceLabel = normalizeLanguageLabel(sourceLanguage)
    const targetLabel = normalizeLanguageLabel(targetLanguage)
    if (!sourceLabel || !targetLabel) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    const prompt =
      targetLabel === "Chinese"
        ? `Translate the following text from ${sourceLabel} to Simplified Chinese. Return only the translated text. Do NOT include pinyin, romanization, notes, explanations, quotes, labels, or parentheses. Preserve proper nouns and names; if a name has no common Chinese translation, keep it in the original script.\n\nText: ${text}`
        : `Translate the following text from ${sourceLabel} to ${targetLabel}. Only return the translated text in the target language, nothing else. Do NOT include pinyin, romanization, transliteration, pronunciation guides, or explanations. If the source is Chinese, translate the meaning (e.g., 你好 -> Hello).\n\nText: ${text}`

    let modelId = ""
    let translatedText = ""

    if (isTencent) {
      const zhipuApiKey = normalizeApiKey(resolveEnvValue("TENCENT_ZHIPU_API_KEY", "ZHIPU_API_KEY"))
      const dashscopeApiKey = normalizeApiKey(resolveEnvValue("TENCENT_DASHSCOPE_API_KEY", "DASHSCOPE_API_KEY"))

      if (!zhipuApiKey && !dashscopeApiKey) {
        return Response.json({ error: "Missing Zhipu/DashScope API key" }, { status: 500 })
      }

      if (zhipuApiKey) {
        try {
          modelId =
            resolveEnvValue("TENCENT_ZHIPU_TRANSLATE_MODEL", "ZHIPU_TRANSLATE_MODEL")?.trim() || "glm-4-flash"
          const baseURL =
            resolveEnvValue("TENCENT_ZHIPU_BASE_URL", "ZHIPU_BASE_URL")?.trim() || "https://open.bigmodel.cn/api/paas/v4"
          const resp = await fetch(`${baseURL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${zhipuApiKey}`,
            },
            body: JSON.stringify({
              model: modelId,
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
              // thinking: { type: "disabled" }, // Remove to improve compatibility with models that don't support it
              temperature: 0.3,
              max_tokens: 1000,
            }),
          })
          if (!resp.ok) {
            const errorText = await resp.text()
            console.error(`[Zhipu API Error] Status: ${resp.status}, Body: ${errorText}`)
            return Response.json({ error: `Failed to call Zhipu API: ${resp.status} ${errorText}` }, { status: 500 })
          }
          const data = (await resp.json()) as Record<string, unknown>
          const choices = data.choices as unknown
          if (Array.isArray(choices) && choices.length > 0) {
            const msg = choices[0]?.message as Record<string, unknown>
            const content = typeof msg?.content === "string" ? msg.content : ""
            const reasoning = typeof msg?.reasoning_content === "string" ? msg.reasoning_content : ""
            translatedText = content || reasoning
          } else {
            translatedText = ""
          }
        } catch (error) {
          if (!dashscopeApiKey) {
            throw error
          }
        }
      }

      if (!translatedText && dashscopeApiKey) {
        modelId =
          resolveEnvValue("TENCENT_DASHSCOPE_TRANSLATE_MODEL", "DASHSCOPE_TRANSLATE_MODEL")?.trim() || "qwen-plus"
        const baseURL =
          resolveEnvValue("TENCENT_DASHSCOPE_BASE_URL", "DASHSCOPE_BASE_URL")?.trim() ||
          "https://dashscope.aliyuncs.com/compatible-mode/v1"
        const provider = createOpenAI({ apiKey: dashscopeApiKey, baseURL })
        const result = await generateText({
          model: provider(modelId),
          prompt,
          maxOutputTokens: 1000,
          temperature: 0.3,
        })
        translatedText = result.text
      }
    } else {
      modelId = resolveMistralTranslateModelId(process.env.MISTRAL_TRANSLATE_MODEL ?? "Mistral-7B-Instruct-v0.3")
      if (!process.env.MISTRAL_API_KEY || !process.env.MISTRAL_API_KEY.trim()) {
        return Response.json({ error: "Missing Mistral API key" }, { status: 500 })
      }
      const result = await generateText({
        model: mistral(modelId),
        prompt,
        maxOutputTokens: 1000,
        temperature: 0.3,
      })
      translatedText = result.text
    }

    const sanitized = sanitizeTranslatedText(translatedText, targetLabel)
    return Response.json(
      { translatedText: sanitized },
      { headers: { "x-translation-model": modelId } },
    )
  } catch (error) {
    console.error("[v0] Translation error:", error)
    return Response.json({ error: "Failed to translate text" }, { status: 500 })
  }
}
