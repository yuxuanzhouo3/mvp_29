'use client'

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { setRoomsAutoDeleteEnabled } from "@/app/admin/actions"

export function RoomAutoDeleteToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setEnabled(initialEnabled)
  }, [initialEnabled])

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">房间 24h 不活跃自动删除</div>
        <div className="text-xs text-muted-foreground">开启后，超过 24 小时无聊天消息的房间会被自动清理</div>
      </div>
      <Switch
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(next) => {
          setEnabled(next)
          startTransition(async () => {
            const res = await setRoomsAutoDeleteEnabled(next)
            if (res.success) {
              toast.success(next ? "已开启自动删除" : "已关闭自动删除")
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
