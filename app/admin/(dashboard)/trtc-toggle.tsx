'use client'

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { setTrtcEnabled } from "@/app/admin/actions"

export function TrtcToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setEnabled(initialEnabled)
  }, [initialEnabled])

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">TRTC 语音通话模式</div>
        <div className="text-xs text-muted-foreground">
          开启后使用 TRTC 进行实时语音通话（成本较高）；关闭后使用标准语音识别方案（成本更低）
        </div>
      </div>
      <Switch
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(next) => {
          setEnabled(next)
          startTransition(async () => {
            const res = await setTrtcEnabled(next)
            if (res.success) {
              toast.success(next ? "已开启 TRTC 模式" : "已关闭 TRTC 模式，使用标准语音识别")
              return
            }
            setEnabled(!next)
            toast.error(res.error ? `设置失败：${res.error}` : "设置失败")
          })
        }}
      />
    </div>
  )
}
