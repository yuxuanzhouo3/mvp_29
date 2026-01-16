<<<<<<< Updated upstream
=======
async function convertToPcm16leMono(audioBlob: Blob, targetSampleRate = 16000): Promise<Uint8Array> {
  if (typeof window === "undefined") {
    throw new Error("audio_conversion_not_supported")
  }

  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) {
    throw new Error("audio_context_not_supported")
  }

  const arrayBuffer = await audioBlob.arrayBuffer()
  const ctx = new AudioContextCtor()

  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    try {
      await ctx.close()
    } catch {}
  }

  const length = Math.max(1, Math.ceil(decoded.duration * targetSampleRate))
  const offline = new OfflineAudioContext(1, length, targetSampleRate)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0)

  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)

  const pcm = new Uint8Array(samples.length * 2)
  const view = new DataView(pcm.buffer)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
    view.setInt16(i * 2, int16, true)
  }

  return pcm
}

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

>>>>>>> Stashed changes
export async function transcribeAudio(audioBlob: Blob, language: string): Promise<string> {
  const formData = new FormData()
  formData.append("audio", audioBlob, "recording.webm")
  formData.append("language", language)

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    })

<<<<<<< Updated upstream
  if (!response.ok) {
    throw new Error("Failed to transcribe audio")
=======
    if (response.ok) {
      const data = (await response.json()) as { text: string }
      return data.text
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const delayMs = Math.min(8000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250)
      await sleep(delayMs)
      continue
    }

    const message = await parseErrorMessage(response)
    throw new Error(message || "转写失败")
>>>>>>> Stashed changes
  }

  throw new Error("转写失败")
}

<<<<<<< Updated upstream
export async function translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
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
  })

  if (!response.ok) {
    throw new Error("Failed to translate text")
=======
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
      const data = (await response.json()) as { translatedText: string }
      return data.translatedText
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
>>>>>>> Stashed changes
  }

  type HttpError = Error & { status?: number }
  const error: HttpError = new Error("翻译失败")
  error.status = 500
  throw error
}
