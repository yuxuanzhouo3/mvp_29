'use client'

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { updateAd } from "@/app/admin/actions"
import { toast } from "sonner"

export type EditableAd = {
  id: string
  slotKey: string
  title: string
  imageUrl?: string | null
  linkUrl?: string | null
  isActive: boolean
}

export function EditAdDialog({ ad, onSaved }: { ad: EditableAd; onSaved?: (next: EditableAd) => void }) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    slotKey: ad.slotKey,
    title: ad.title,
    imageUrl: ad.imageUrl || "",
    linkUrl: ad.linkUrl || "",
    isActive: ad.isActive,
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setFormData({
        slotKey: ad.slotKey,
        title: ad.title,
        imageUrl: ad.imageUrl || "",
        linkUrl: ad.linkUrl || "",
        isActive: ad.isActive,
      })
    }
    setOpen(nextOpen)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)

    const payload = {
      slotKey: formData.slotKey.trim(),
      title: formData.title.trim(),
      imageUrl: formData.imageUrl.trim() || undefined,
      linkUrl: formData.linkUrl.trim() || undefined,
      isActive: formData.isActive,
    }

    const result = await updateAd(ad.id, payload)
    setIsLoading(false)

    if (result.success) {
      toast.success("广告内容已更新")
      setOpen(false)
      onSaved?.({
        id: ad.id,
        slotKey: payload.slotKey,
        title: payload.title,
        imageUrl: payload.imageUrl || null,
        linkUrl: payload.linkUrl || null,
        isActive: payload.isActive,
      })
    } else {
      toast.error("更新失败: " + result.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-transparent">
          <Pencil className="h-4 w-4 mr-2" />
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>编辑广告位</DialogTitle>
          <DialogDescription>修改标题、图片链接、跳转链接与启用状态。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editSlotKey" className="text-right">
                广告位标识
              </Label>
              <Input
                id="editSlotKey"
                value={formData.slotKey}
                onChange={(e) => setFormData({ ...formData, slotKey: e.target.value })}
                placeholder="例如: home_top"
                className="col-span-3"
                required
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editTitle" className="text-right">
                标题
              </Label>
              <Input
                id="editTitle"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="例如: 新年活动"
                className="col-span-3"
                required
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editImageUrl" className="text-right">
                图片URL
              </Label>
              <Input
                id="editImageUrl"
                value={formData.imageUrl}
                onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                placeholder="https://..."
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editLinkUrl" className="text-right">
                跳转URL
              </Label>
              <Input
                id="editLinkUrl"
                value={formData.linkUrl}
                onChange={(e) => setFormData({ ...formData, linkUrl: e.target.value })}
                placeholder="https://..."
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <div className="text-right text-sm font-medium">启用</div>
              <div className="col-span-3 flex items-center gap-3">
                <Switch checked={formData.isActive} onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })} />
                <span className="text-sm text-muted-foreground">{formData.isActive ? "已启用" : "已停用"}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "保存中..." : "保存修改"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
