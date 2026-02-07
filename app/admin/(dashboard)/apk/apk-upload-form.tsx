'use client'

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Download, Upload, Smartphone, Monitor, Globe, HardDrive, Package } from "lucide-react"
import { Badge } from "@/components/ui/badge"

type ReleaseInfo = {
  version?: string
  filename?: string
  size?: number
  updatedAt?: string
}

export function ReleaseUploadForm({
  release,
  platform,
  title,
  accept,
}: {
  release: ReleaseInfo | null
  platform: string
  title: string
  accept?: string
}) {
  const [version, setVersion] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()

  const formattedSize = useMemo(() => {
    if (!release?.size) return "-"
    const mb = release.size / 1024 / 1024
    return `${mb.toFixed(2)} MB`
  }, [release?.size])

  const downloadUrl = `/api/downloads?platform=${platform}`

  const iconMap: Record<string, React.ReactNode> = {
    android: <Smartphone className="h-6 w-6" />,
    ios: <Smartphone className="h-6 w-6" />,
    harmony: <Smartphone className="h-6 w-6" />,
    windows: <Monitor className="h-6 w-6" />,
    macos: <Monitor className="h-6 w-6" />,
    linux: <Monitor className="h-6 w-6" />,
    chrome: <Globe className="h-6 w-6" />,
    firefox: <Globe className="h-6 w-6" />,
  }

  const PlatformIcon = iconMap[platform] || <Package className="h-6 w-6" />

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!version.trim()) {
      toast.error("请填写版本号")
      return
    }
    if (!file) {
      toast.error("请上传安装包或文件")
      return
    }
    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.set("platform", platform)
      formData.set("version", version.trim())
      formData.set("file", file)

      const res = await fetch("/api/releases/upload", {
        method: "POST",
        body: formData,
      })
      const data = await res.json()
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "上传失败")
      }
      toast.success("版本已更新")
      setFile(null)
      setVersion("")
      setIsOpen(false)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败"
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const lastUpdated = release?.updatedAt
    ? new Date(release.updatedAt).toLocaleDateString()
    : "未发布"

  return (
    <Card className="flex flex-col h-full overflow-hidden transition-all hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-2 rounded-lg text-primary">
            {PlatformIcon}
          </div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
        </div>
        {release?.version && (
          <Badge variant="secondary" className="font-normal">
            v{release.version}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex-1 pt-6">
        <div className="grid gap-3 text-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>文件大小</span>
            <span className="font-medium text-foreground">{formattedSize}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>更新时间</span>
            <span className="font-medium text-foreground">{lastUpdated}</span>
          </div>
          {release?.filename && (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>文件名</span>
              <span className="font-medium text-foreground max-w-[150px] truncate" title={release.filename}>
                {release.filename}
              </span>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex items-center gap-2 pt-4 border-t bg-muted/10">
        {release?.version ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            asChild
          >
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" />
              下载
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            disabled
          >
            <Download className="h-4 w-4" />
            下载
          </Button>
        )}

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex-1 gap-2">
              <Upload className="h-4 w-4" />
              更新
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>更新 {title} 版本</DialogTitle>
              <DialogDescription>
                上传新的安装包以发布新版本。
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor={`${platform}-version`}>版本号</Label>
                <Input
                  id={`${platform}-version`}
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="例如：1.2.3"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${platform}-file`}>安装包文件</Label>
                <Input
                  id={`${platform}-file`}
                  type="file"
                  accept={accept}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  支持格式: {accept?.split(',').join(', ') || '所有文件'}
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting}>
                  取消
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "上传中..." : "确认发布"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  )
}
