import { generateText } from "ai"

export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const audioFile = formData.get("audio") as File
    const language = formData.get("language") as string

    if (!audioFile) {
      return Response.json({ error: "No audio file provided" }, { status: 400 })
    }

    // Convert audio file to base64
    const arrayBuffer = await audioFile.arrayBuffer()
    const base64Audio = Buffer.from(arrayBuffer).toString("base64")

    // Use AI SDK to transcribe audio
    const { text } = await generateText({
      model: "openai/gpt-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Transcribe this audio in ${language}. Only return the transcribed text, nothing else.`,
            },
            {
              type: "file",
              data: base64Audio,
              mediaType: audioFile.type,
            },
          ],
        },
      ],
      maxOutputTokens: 1000,
    })

    return Response.json({ text: text.trim() })
  } catch (error) {
    console.error("[v0] Transcription error:", error)
    return Response.json({ error: "Failed to transcribe audio" }, { status: 500 })
  }
}
