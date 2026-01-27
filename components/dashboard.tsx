"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, MonitorSpeaker } from "lucide-react"
import Link from "next/link"
import { useI18n } from "@/components/i18n-provider"

export function Dashboard() {
  const { t } = useI18n()

  return (
    <div className="container mx-auto p-4 md:p-8 min-h-screen flex flex-col justify-center max-w-4xl">
      <h1 className="text-3xl font-bold text-center mb-8">AI Translate</h1>
      
      <div className="grid md:grid-cols-2 gap-6">
        <Link href="/room" className="block group">
          <Card className="h-full transition-all hover:border-primary hover:shadow-lg cursor-pointer">
            <CardHeader className="text-center">
              <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4 group-hover:bg-primary/20 transition-colors">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <CardTitle>多人会议室</CardTitle>
              <CardDescription>
                创建或加入房间，进行多语言实时语音对话翻译
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>支持多人同时在线</li>
                <li>实时语音转写与翻译</li>
                <li>适合跨语言会议交流</li>
              </ul>
            </CardContent>
          </Card>
        </Link>

        <Link href="/system-audio" className="block group">
          <Card className="h-full transition-all hover:border-primary hover:shadow-lg cursor-pointer">
            <CardHeader className="text-center">
              <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4 group-hover:bg-primary/20 transition-colors">
                <MonitorSpeaker className="w-8 h-8 text-primary" />
              </div>
              <CardTitle>系统同声传译</CardTitle>
              <CardDescription>
                捕获系统音频，实时翻译视频会议或媒体内容
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>监听电脑系统声音</li>
                <li>适合观看外语视频/会议</li>
                <li>无需麦克风输入</li>
              </ul>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
