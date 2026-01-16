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

export const dynamic = 'force-dynamic';

type RoomRow = {
  id: string
  created_at: string | null
} & Record<string, unknown>

export default async function RoomsPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let rooms: RoomRow[] = [];

  try {
    if (supabaseUrl && supabaseKey) {
      // 如果有 Service Role Key (通常在服务端环境变量中)，优先使用它以绕过 RLS
      // 否则使用 Anon Key (受 RLS 限制)
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey;
      const supabase = createClient(supabaseUrl, key);

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
