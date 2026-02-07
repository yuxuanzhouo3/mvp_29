import { ReleaseUploadForm } from "./apk-upload-form"
import { getPrisma } from "@/lib/prisma"
import { createClient } from "@supabase/supabase-js"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export const dynamic = "force-dynamic"

const isTencentTarget = () => {
  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  return publicTarget === "tencent" || privateTarget === "tencent"
}

const getSupabase = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error("缺少 Supabase 环境变量")
  return createClient(supabaseUrl, supabaseKey)
}

async function getRelease(platform: string) {
  const variant = isTencentTarget() ? "domestic" : "international"
  const settingKey = `${platform}_release_${variant}`

  if (isTencentTarget()) {
    const prisma = await getPrisma()
    const row = await prisma.appSetting.findUnique({ where: { key: settingKey } })
    const value = row?.value
    const release =
      typeof value === "object" && value
        ? {
          version: "version" in value ? String(value.version || "") : "",
          filename: "filename" in value ? String(value.filename || "") : "",
          size: "size" in value ? Number(value.size || 0) : 0,
          updatedAt: "updatedAt" in value ? String(value.updatedAt || "") : "",
          fileId: "fileId" in value ? String(value.fileId || "") : "",
          link: "link" in value ? String(value.link || "") : "",
        }
        : null
    if (!release?.fileId && !release?.link) return null
    return release
  }

  const supabase = getSupabase()
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", settingKey).limit(1)
  if (error) return null
  const value = (data?.[0] as { value?: unknown } | undefined)?.value
  const release =
    typeof value === "object" && value
      ? {
        version: "version" in value ? String(value.version || "") : "",
        filename: "filename" in value ? String(value.filename || "") : "",
        size: "size" in value ? Number(value.size || 0) : 0,
        updatedAt: "updatedAt" in value ? String(value.updatedAt || "") : "",
        path: "path" in value ? String(value.path || "") : "",
        link: "link" in value ? String(value.link || "") : "",
      }
      : null
  if (!release?.path && !release?.link) return null
  return release
}

export default async function ApkPage() {
  const variant = isTencentTarget() ? "domestic" : "international"
  const android = await getRelease("android")
  const ios = await getRelease("ios")
  const windows = await getRelease("windows")
  const macos = await getRelease("macos")
  const linux = await getRelease("linux")
  const chrome = await getRelease("chrome")
  const firefox = await getRelease("firefox")
  const harmony = await getRelease("harmony")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">版本管理</h2>
        <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-md">
          当前环境: {variant === "domestic" ? "国内版" : "国际版"}
        </div>
      </div>

      <Tabs defaultValue="mobile" className="w-full">
        <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
          <TabsTrigger value="mobile">移动端</TabsTrigger>
          <TabsTrigger value="desktop">桌面端</TabsTrigger>
          <TabsTrigger value="extension">浏览器扩展</TabsTrigger>
        </TabsList>
        <TabsContent value="mobile" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <ReleaseUploadForm release={android} platform="android" title="Android" accept=".apk" />
            <ReleaseUploadForm release={ios} platform="ios" title="iOS" accept=".ipa" />
            <ReleaseUploadForm release={harmony} platform="harmony" title="HarmonyOS" accept=".apk,.hap" />
          </div>
        </TabsContent>
        <TabsContent value="desktop" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <ReleaseUploadForm release={windows} platform="windows" title="Windows" accept=".exe,.msi,.zip" />
            <ReleaseUploadForm release={macos} platform="macos" title="macOS" accept=".dmg,.pkg,.zip" />
            <ReleaseUploadForm release={linux} platform="linux" title="Linux" accept=".AppImage,.deb,.rpm,.tar.gz,.zip" />
          </div>
        </TabsContent>
        <TabsContent value="extension" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <ReleaseUploadForm release={chrome} platform="chrome" title="Chrome / Edge" accept=".zip,.crx" />
            <ReleaseUploadForm release={firefox} platform="firefox" title="Firefox" accept=".xpi,.zip" />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
