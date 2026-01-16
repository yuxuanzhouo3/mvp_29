import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@supabase/supabase-js"
import { format } from "date-fns"
import { UserActions } from "./user-actions"
import { CreateUserDialog } from "./create-user-dialog"

export const dynamic = 'force-dynamic';

type ProfileRow = {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
  created_at: string | null
} & Record<string, unknown>

export default async function UsersPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let users: ProfileRow[] = [];

  try {
    if (supabaseUrl && supabaseKey) {
      // 如果有 Service Role Key (通常在服务端环境变量中)，优先使用它以绕过 RLS
      // 否则使用 Anon Key (受 RLS 限制)
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey;
      const supabase = createClient(supabaseUrl, key);
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error("Supabase error fetching users:", error);
      }

      if (data) users = data;
    }
  } catch (err) {
    console.error("Unexpected error in UsersPage:", err);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">用户管理</h2>
        <CreateUserDialog />
      </div>
      <div className="border rounded-md bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">头像</TableHead>
              <TableHead>用户ID</TableHead>
              <TableHead>显示名称</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  暂无用户数据
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Avatar>
                      <AvatarImage src={user.avatar_url} />
                      <AvatarFallback>{user.display_name?.slice(0, 2).toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{user.id}</TableCell>
                  <TableCell>{user.display_name || '-'}</TableCell>
                  <TableCell>{user.email || '-'}</TableCell>
                  <TableCell>{user.created_at ? format(new Date(user.created_at), 'yyyy-MM-dd HH:mm') : '-'}</TableCell>
                  <TableCell className="text-right">
                    <UserActions user={user} />
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
