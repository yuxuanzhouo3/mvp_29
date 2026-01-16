'use client'

import { useState } from "react"
import { Trash } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { deleteRoom } from "@/app/admin/actions"
import { toast } from "sonner"

interface RoomActionsProps {
  room: { id: string }
}

export function RoomActions({ room }: RoomActionsProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [open, setOpen] = useState(false)

  async function handleDelete() {
    setIsLoading(true)
    const result = await deleteRoom(room.id)
    setIsLoading(false)
    setOpen(false)

    if (result.success) {
      toast.success("房间已删除")
    } else {
      toast.error("删除失败: " + result.error)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
            <Trash className="h-4 w-4 mr-2" />
            删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除此房间？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作将删除房间及其所有消息记录，且无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction 
            onClick={(e) => { e.preventDefault(); handleDelete(); }}
            className="bg-red-600 hover:bg-red-700"
            disabled={isLoading}
          >
            {isLoading ? "删除中..." : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
