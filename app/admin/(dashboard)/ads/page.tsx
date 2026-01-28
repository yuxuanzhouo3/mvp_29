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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CreateAdDialog } from "./create-ad-dialog"
import { AdActions } from "./ad-actions"
import { getPrisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

type AdRow = {
  id: string
  slot_key: string
  title: string | null
  image_url: string | null
  link_url: string | null
  is_active: boolean | null
  created_at: string | Date | null
  updated_at: string | Date | null
} & Record<string, unknown>

export default async function AdsPage() {
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
    .trim()
    .toLowerCase()
  const isTencent = target === "tencent"
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  let ads: AdRow[] = []
  let loadError: string | null = null

  try {
    if (isTencent) {
      const prisma = await getPrisma()
      const data = await prisma.ad.findMany({ orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] })
      ads = data.map((ad) => ({
        id: ad.id,
        slot_key: ad.slotKey,
        title: ad.title,
        image_url: ad.imageUrl,
        link_url: ad.linkUrl,
        is_active: ad.isActive,
        created_at: ad.createdAt,
        updated_at: ad.updatedAt,
      }))
    } else if (supabaseUrl && supabaseKey) {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey
      const supabase = createClient(supabaseUrl, key)

      const { data, error } = await supabase.from("ads").select("*").order("created_at", { ascending: false })
      if (error) {
        loadError = error.message
      } else if (data) {
        ads = data as AdRow[]
      }
    } else {
      loadError = "缺少 Supabase 环境变量"
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "加载失败"
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">广告管理</h2>
        <CreateAdDialog disabled={Boolean(loadError)} />
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>无法加载广告数据</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <p className="mt-2">如果提示不存在 relation &quot;ads&quot;，请先在 Supabase 创建 ads 表。</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="border rounded-md bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>广告位标识</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  暂无广告位数据
                </TableCell>
              </TableRow>
            ) : (
              ads.map((ad) => (
                <TableRow key={ad.id}>
                  <TableCell className="font-mono">{ad.slot_key}</TableCell>
                  <TableCell className="max-w-[420px] truncate">{ad.title || "-"}</TableCell>
                  <TableCell>
                    {ad.is_active ? <Badge variant="secondary">启用</Badge> : <Badge variant="outline">停用</Badge>}
                  </TableCell>
                  <TableCell>
                    {ad.updated_at ? format(new Date(ad.updated_at), "yyyy-MM-dd HH:mm") : ad.created_at ? format(new Date(ad.created_at), "yyyy-MM-dd HH:mm") : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <AdActions
                      ad={{
                        id: ad.id,
                        slotKey: ad.slot_key,
                        title: ad.title || "",
                        imageUrl: ad.image_url,
                        linkUrl: ad.link_url,
                        isActive: Boolean(ad.is_active),
                      }}
                    />
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
