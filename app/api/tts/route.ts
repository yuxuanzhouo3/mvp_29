import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const text = searchParams.get("text")
  const lang = searchParams.get("lang") || "zh"

  if (!text) {
    return NextResponse.json({ error: "Missing text parameter" }, { status: 400 })
  }

  // Determine language codes for different providers
  let sogouLang = "en"
  let youdaoLang = "en"

  // Simple mapping
  if (lang.startsWith("zh")) {
    sogouLang = "zh-CHS"
    youdaoLang = "zh"
  } else if (lang.startsWith("ja")) {
    sogouLang = "ja"
    youdaoLang = "jap"
  } else if (lang.startsWith("ko")) {
    sogouLang = "ko"
    youdaoLang = "ko"
  } else if (lang.startsWith("fr")) {
    sogouLang = "fr"
    youdaoLang = "fr"
  } else if (lang.startsWith("de")) {
    sogouLang = "de"
    youdaoLang = "de"
  } else if (lang.startsWith("es")) {
    sogouLang = "es"
    youdaoLang = "es"
  }

  // Provider URLs
  const sogouUrl = `https://fanyi.sogou.com/reventondc/synthesis?text=${encodeURIComponent(text)}&speed=1&lang=${sogouLang}&from=translateweb&speaker=6`
  const youdaoUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=${youdaoLang}`

  try {
    // 1. Try Sogou first
    console.log("[TTS Proxy] Trying Sogou:", sogouUrl)
    let response = await fetch(sogouUrl, {
      headers: {
        "Referer": "https://fanyi.sogou.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    })

    if (!response.ok || response.headers.get("content-type")?.includes("application/json") || response.headers.get("content-length") === "0") {
      console.warn("[TTS Proxy] Sogou failed or returned invalid content, trying Youdao...")
      // 2. Fallback to Youdao
      response = await fetch(youdaoUrl, {
        headers: {
          "Referer": "https://dict.youdao.com/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      })
    }

    if (!response.ok) {
      throw new Error(`Both providers failed. Last status: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=86400"
      }
    })

  } catch (error: any) {
    console.error("[TTS Proxy] Error:", error)
    return NextResponse.json({ error: "TTS generation failed", details: error.message }, { status: 500 })
  }
}
