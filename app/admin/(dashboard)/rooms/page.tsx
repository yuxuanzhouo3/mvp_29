import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@supabase/supabase-js"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { RoomActions } from "./room-actions"
import { CreateRoomDialog } from "./create-room-dialog"
import { RoomAutoDeleteToggle } from "./room-auto-delete-toggle"
import { getPrisma } from "@/lib/prisma"

export const dynamic = 'force-dynamic';

type RoomRow = {
  id: string
  created_at: string | null
} & Record<string, unknown>

export default async function RoomsPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
    .trim()
    .toLowerCase()
  const isTencent = target === "tencent"

  let rooms: RoomRow[] = [];
  let autoDeleteEnabled = false

  try {
    if (isTencent) {
      const prisma = await getPrisma()
      const settingRow = await prisma.appSetting.findUnique({ where: { key: "rooms_auto_delete_after_24h" } })
      const settingValue = settingRow?.value
      autoDeleteEnabled =
        typeof settingValue === "boolean"
          ? settingValue
          : typeof settingValue === "object" &&
              settingValue !== null &&
              typeof (settingValue as { enabled?: unknown }).enabled === "boolean"
            ? Boolean((settingValue as { enabled: boolean }).enabled)
            : false

      const data = await prisma.room.findMany({ orderBy: { createdAt: "desc" } })
      rooms = data.map((room) => ({
        id: room.id,
        created_at: room.createdAt ? room.createdAt.toISOString() : null,
      }))
    } else if (supabaseUrl && supabaseKey) {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey;
      const supabase = createClient(supabaseUrl, key);

      const { data: settingRow } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "rooms_auto_delete_after_24h")
        .maybeSingle()
      const settingValue = (settingRow as { value?: unknown } | null)?.value
      autoDeleteEnabled =
        typeof settingValue === "boolean"
          ? settingValue
          : typeof settingValue === "object" &&
              settingValue !== null &&
              typeof (settingValue as { enabled?: unknown }).enabled === "boolean"
            ? Boolean((settingValue as { enabled: boolean }).enabled)
            : false

      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error("Supabase error fetching rooms:", error);
      }

      if (data) rooms = data;
    }
  } catch (err) {
    console.error("Unexpected error in RoomsPage:", err);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">房间管理</h2>
        <CreateRoomDialog />
      </div>
      <RoomAutoDeleteToggle initialEnabled={autoDeleteEnabled} />
      <div className="border rounded-md bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>房间ID</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  暂无房间数据
                </TableCell>
              </TableRow>
            ) : (
              rooms.map((room) => (
                <TableRow key={room.id}>
                  <TableCell className="font-mono">{room.id}</TableCell>
                  <TableCell>{room.created_at ? format(new Date(room.created_at), 'yyyy-MM-dd HH:mm') : '-'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">活跃</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <RoomActions room={room} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
