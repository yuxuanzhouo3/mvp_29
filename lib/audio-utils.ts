function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const id = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }
    const cleanup = () => {
      clearTimeout(id)
      if (signal) signal.removeEventListener("abort", onAbort)
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true })
  })
}

async function parseErrorMessage(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
  return data?.error || data?.message || `请求失败（${response.status}）`
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 120).trim()
    const extra = snippet ? `，响应开头：${snippet}` : ""
    throw new Error(`接口返回非 JSON（${response.status}）${extra}`)
  }
}

type WhisperAsrResult = { text?: string }
type WhisperAsrPipeline = (input: Float32Array, options?: Record<string, unknown>) => Promise<WhisperAsrResult>

let whisperPipelinePromise: Promise<WhisperAsrPipeline> | null = null

function getWhisperLanguageHint(value: string): string | undefined {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return undefined
  const normalized = raw.toLowerCase().replaceAll("_", "-")
  const primary = normalized.split("-")[0] ?? normalized

  if (primary === "zh") return "chinese"
  if (primary === "en") return "english"
  if (primary === "ja") return "japanese"
  if (primary === "ko") return "korean"
  if (primary === "fr") return "french"
  if (primary === "de") return "german"
  if (primary === "es") return "spanish"
  if (primary === "pt") return "portuguese"

  return undefined
}

async function decodeAudioBlobTo16kMonoFloat32(audioBlob: Blob): Promise<Float32Array> {
  const arrayBuffer = await audioBlob.arrayBuffer()
  const AudioContextCtor =
    (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) {
    throw new Error("AudioContext unavailable")
  }

  const audioContext = new AudioContextCtor()
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const targetSampleRate = 16000
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSampleRate), targetSampleRate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start(0)
    const rendered = await offline.startRendering()
    return rendered.getChannelData(0)
  } finally {
    try {
      await audioContext.close()
    } catch {}
  }
}

async function getWhisperPipeline(): Promise<WhisperAsrPipeline> {
  if (whisperPipelinePromise) return whisperPipelinePromise

  whisperPipelinePromise = (async () => {
    const { pipeline, env } = await import("@xenova/transformers")

    env.allowLocalModels = false
    env.useBrowserCache = true

    const modelId = process.env.NEXT_PUBLIC_WHISPER_MODEL?.trim() || "Xenova/whisper-tiny"
    const transcriber = (await pipeline("automatic-speech-recognition", modelId)) as unknown as WhisperAsrPipeline
    return transcriber
  })()

  return whisperPipelinePromise
}

export async function transcribeAudio(audioBlob: Blob, language: string): Promise<string> {
  if (typeof window !== "undefined") {
    try {
      const transcriber = await getWhisperPipeline()
      const audio = await decodeAudioBlobTo16kMonoFloat32(audioBlob)
      const hint = getWhisperLanguageHint(language)
      const output = await transcriber(audio, { ...(hint ? { language: hint } : {}), task: "transcribe" })
      const text = typeof output?.text === "string" ? output.text.trim() : ""
      if (text) return text
      throw new Error("Empty transcription result")
    } catch {
      // fall through to server-side transcription if whisper fails
    }
  }

  const formData = new FormData()
  formData.append("audio", audioBlob, "recording.webm")
  formData.append("language", language)

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    })

    if (response.ok) {
      const data = await parseJsonResponse<{ text?: unknown }>(response)
      if (typeof data.text === "string") return data.text
      throw new Error("接口返回异常：缺少 text 字段")
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const delayMs = Math.min(8000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250)
      await sleep(delayMs)
      continue
    }

    const message = await parseErrorMessage(response)
    throw new Error(message || "转写失败")
  }

  throw new Error("转写失败")
}

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<string> {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        sourceLanguage,
        targetLanguage,
      }),
      signal,
    })

    if (response.ok) {
      const data = await parseJsonResponse<{ translatedText?: unknown }>(response)
      if (typeof data.translatedText === "string") return data.translatedText
      throw new Error("接口返回异常：缺少 translatedText 字段")
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const delayMs = Math.min(8000, 1200 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250)
      await sleep(delayMs, signal)
      continue
    }

    const message = await parseErrorMessage(response)
    type HttpError = Error & { status?: number }
    const error: HttpError = new Error(message || `翻译失败（${response.status}）`)
    error.status = response.status
    throw error
  }

  type HttpError = Error & { status?: number }
  const error: HttpError = new Error("翻译失败")
  error.status = 500
  throw error
}
