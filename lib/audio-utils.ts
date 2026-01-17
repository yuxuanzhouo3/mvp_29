export async function transcribeAudio(audioBlob: Blob, language: string): Promise<string> {
  const formData = new FormData()
  formData.append("audio", audioBlob, "recording.webm")
  formData.append("language", language)

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    throw new Error("Failed to transcribe audio")
  }

  const data = await response.json()
  return data.text
}

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
  }

  const data = await response.json()
  return data.translatedText
}
