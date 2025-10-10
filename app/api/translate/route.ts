import { generateText } from "ai"

export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const { text, sourceLanguage, targetLanguage } = await req.json()

    if (!text || !sourceLanguage || !targetLanguage) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Use AI SDK to translate text
    const { text: translatedText } = await generateText({
      model: "openai/gpt-5",
      prompt: `Translate the following text from ${sourceLanguage} to ${targetLanguage}. Only return the translated text, nothing else.\n\nText: ${text}`,
      maxOutputTokens: 1000,
      temperature: 0.3,
    })

    return Response.json({ translatedText: translatedText.trim() })
  } catch (error) {
    console.error("[v0] Translation error:", error)
    return Response.json({ error: "Failed to translate text" }, { status: 500 })
  }
}
