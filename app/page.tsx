import { LandingPage } from "@/components/landing-page"
import { headers } from "next/headers"

type HomeProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

const getParamValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function Home({ searchParams }: HomeProps) {
  const headerList = await headers()
  const ua = (headerList.get("user-agent") || "").toLowerCase()
  const params = searchParams ?? {}
  const envParam = getParamValue(params._wxjs_environment)
  const fromParam = getParamValue(params.from)
  const mpParam = getParamValue(params.mp)
  const isMiniProgram =
    ua.includes("miniprogram") ||
    envParam === "miniprogram" ||
    fromParam === "miniprogram" ||
    fromParam === "miniProgram" ||
    fromParam === "mp" ||
    mpParam === "1" ||
    mpParam === "true"
  const isApp = ua.includes("median") || ua.includes("gonative")
  const showFull = !(isMiniProgram || isApp)

  return (
    <main className="min-h-screen bg-background">
      <LandingPage showFull={showFull} />
    </main>
  )
}
