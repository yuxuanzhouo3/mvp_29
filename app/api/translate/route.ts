import { generateText } from "ai"
import { mistral } from "@ai-sdk/mistral"

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

  const firstLatinIdx = out.search(/[A-Za-zÀ-ÿ]/)
  if (firstLatinIdx > 0) {
    const head = out.slice(0, firstLatinIdx)
    const tail = out.slice(firstLatinIdx)
    const hasCjkInHead = /[\u4e00-\u9fff]/.test(head)
    const hasCjkInTail = /[\u4e00-\u9fff]/.test(tail)
    if (hasCjkInHead && !hasCjkInTail) out = head
  }

  return out.replaceAll(/\s+/g, " ").trim()
}

function sanitizeTranslatedText(text: string, targetLabel: string): string {
  const cleaned = text.trim()
  if (!cleaned) return cleaned
  if (targetLabel === "Chinese") return sanitizeChineseTranslation(cleaned)
  return cleaned
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

export async function POST(req: Request) {
  try {
    const modelId = resolveMistralTranslateModelId(process.env.MISTRAL_TRANSLATE_MODEL ?? "Mistral-7B-Instruct-v0.3")
    if (!process.env.MISTRAL_API_KEY || !process.env.MISTRAL_API_KEY.trim()) {
      return Response.json({ error: "Missing Mistral API key" }, { status: 500 })
    }
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
        ? `Translate the following text from ${sourceLabel} to Simplified Chinese. Output ONLY Simplified Chinese characters. Do NOT include pinyin, romanization, English, notes, explanations, quotes, labels, or parentheses.\n\nText: ${text}`
        : `Translate the following text from ${sourceLabel} to ${targetLabel}. Only return the translated text in the target language, nothing else.\n\nText: ${text}`

    const { text: translatedText } = await generateText({
      model: mistral(modelId),
      prompt,
      maxOutputTokens: 1000,
      temperature: 0.3,
    })

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
