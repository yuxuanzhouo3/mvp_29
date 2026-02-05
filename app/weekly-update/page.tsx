"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { motion, useScroll, useTransform } from "framer-motion"
import { Mic, Smartphone, Zap, Shield, Sparkles, ArrowRight, CheckCircle2, QrCode, Globe, Radio, MessageSquare, Share2, Wifi, PhoneOff } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { useRef } from "react"

export default function WeeklyUpdatePage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  })

  return (
    <div ref={containerRef} className="min-h-screen bg-background relative selection:bg-primary/20">
      {/* Brand Logo Fixed */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
        className="fixed top-6 left-6 z-50 flex items-center gap-2 bg-background/80 backdrop-blur-md px-4 py-2 rounded-full border shadow-sm"
      >
        <div className="relative w-8 h-8 rounded-lg overflow-hidden">
          <Image
            src="/logo.png"
            alt="MornSpeaker Logo"
            fill
            className="object-cover"
          />
        </div>
        <span className="font-bold text-lg tracking-tight">MornSpeaker</span>
      </motion.div>

      {/* ProgressBar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-blue-500 to-purple-500 origin-left z-50"
        style={{ scaleX: scrollYProgress }}
      />

      {/* Hero Section */}
      <section className="min-h-[90vh] flex flex-col items-center justify-center relative overflow-hidden p-6">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-[40rem] h-[40rem] bg-primary/10 rounded-full blur-[128px]" />
          <div className="absolute bottom-1/4 right-1/4 w-[40rem] h-[40rem] bg-blue-500/10 rounded-full blur-[128px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center z-10 space-y-8 max-w-4xl"
        >
          <Badge variant="secondary" className="px-6 py-2 text-lg rounded-full border border-primary/20 bg-background/50 backdrop-blur-sm shadow-sm">
            🎉 版本 v2.9.0 更新周报
          </Badge>

          <h1 className="text-6xl md:text-8xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground to-muted-foreground/50">
            连接，<br className="md:hidden" />从未如此简单
          </h1>

          <p className="text-xl md:text-3xl text-muted-foreground font-light leading-relaxed">
            本周我们带来了两个重磅更新：<br />
            <span className="text-primary font-medium">全双工实时语音通话翻译</span> 与 <span className="text-[#07C160] font-medium">微信小程序原生体验</span>
          </p>

          <div className="pt-8 animate-bounce">
            <ArrowRight className="w-8 h-8 mx-auto text-muted-foreground rotate-90" />
          </div>
        </motion.div>
      </section>

      {/* Feature 1: Real-time Voice */}
      <section className="min-h-screen py-24 relative bg-muted/30">
        <div className="container mx-auto px-6 md:px-12">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8 }}
              className="space-y-8"
            >
              <div className="inline-flex items-center gap-2 text-primary font-semibold tracking-wider uppercase text-sm">
                <Radio className="w-4 h-4 animate-pulse" />
                Core Feature Update
              </div>
              <h2 className="text-4xl md:text-6xl font-bold leading-tight">
                实时语音通话翻译<br />
                <span className="text-primary">
                  沟通零距离
                </span>
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                基于 WebRTC 技术重构的语音核心，为您带来毫秒级的超低延迟体验。无论是跨国会议还是远程协作，都能像面对面一样流畅自然。
              </p>

              <div className="grid gap-6">
                <DetailCard
                  icon={<Zap className="w-5 h-5 text-yellow-500" />}
                  title="毫秒级响应"
                  desc="端到端延迟优化至 200ms 以内，告别对讲机式的卡顿对话。"
                />
                <DetailCard
                  icon={<Shield className="w-5 h-5 text-green-500" />}
                  title="智能静音控制"
                  desc="修复了静音状态下的音频泄露问题，彻底切断数据流，隐私安全无忧。"
                />
                <DetailCard
                  icon={<Globe className="w-5 h-5 text-blue-500" />}
                  title="同声传译"
                  desc="语音流实时转文字并翻译，支持中英日韩等多种语言双向互译。"
                />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative"
            >
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-purple-500/20 rounded-3xl blur-3xl -z-10" />
              <div className="bg-background border border-border/50 rounded-3xl shadow-2xl p-8 md:p-12 relative overflow-hidden">
                {/* Abstract UI representation */}
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between border-b pb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                        <Mic className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <div className="font-bold text-lg">正在通话中...</div>
                        <div className="text-sm text-green-500 flex items-center gap-1">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          信号极佳 12ms
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-1 bg-red-500/10 text-red-500 rounded-full text-xs font-medium">
                      REC
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-muted p-4 rounded-xl rounded-tl-none">
                      <p className="text-sm text-muted-foreground mb-1">Alice (English)</p>
                      <p className="text-lg">Hello, how is the project going?</p>
                      <p className="text-sm text-primary mt-1">你好，项目进展如何？</p>
                    </div>
                    <div className="bg-primary/5 p-4 rounded-xl rounded-tr-none ml-auto max-w-[90%]">
                      <p className="text-sm text-muted-foreground mb-1 text-right">You (Chinese)</p>
                      <p className="text-lg text-right">一切顺利，我们刚刚上线了新版本。</p>
                      <p className="text-sm text-primary mt-1 text-right">Everything is going well, we just launched the new version.</p>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-center gap-6">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 cursor-pointer">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/30 cursor-pointer hover:scale-105 transition-transform">
                      <PhoneOff className="w-8 h-8 text-white" />
                    </div>
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 cursor-pointer">
                      <Mic className="w-5 h-5" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Feature 2: WeChat Mini Program */}
      <section className="min-h-screen py-24 relative overflow-hidden">
        <div className="container mx-auto px-6 md:px-12">
          <div className="grid lg:grid-cols-2 gap-16 items-center lg:flex-row-reverse">
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8 }}
              className="order-1 lg:order-2 space-y-8"
            >
              <div className="inline-flex items-center gap-2 text-green-600 font-semibold tracking-wider uppercase text-sm">
                <Smartphone className="w-4 h-4" />
                Platform Expansion
              </div>
              <h2 className="text-4xl md:text-6xl font-bold leading-tight">
                微信小程序<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-teal-400">
                  触手可及
                </span>
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                无需下载 App，无需打开电脑。拿出手机扫一扫，立刻加入会议。完美适配移动端操作习惯，让协作随时随地发生。
              </p>

              <div className="grid gap-6">
                <DetailCard
                  icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
                  title="原生体验"
                  desc="针对微信环境深度优化，启动速度提升 50%，操作丝般顺滑。"
                />
                <DetailCard
                  icon={<Share2 className="w-5 h-5 text-blue-500" />}
                  title="一键邀请"
                  desc="直接通过微信分享会议卡片，好友点击即入会，无需输入繁琐的会议号。"
                />
                <DetailCard
                  icon={<Wifi className="w-5 h-5 text-purple-500" />}
                  title="数据互通"
                  desc="Web 端与小程序端数据完全实时同步，无缝切换设备。"
                />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="order-2 lg:order-1 flex justify-center items-center relative"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-green-500/10 to-transparent rounded-full blur-3xl -z-10" />

              {/* Phone Mockup */}
              <div className="w-[300px] h-[600px] border-8 border-slate-900 rounded-[3rem] bg-slate-950 shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-900 rounded-b-xl z-20" />

                {/* Screen Content */}
                <div className="w-full h-full bg-background flex flex-col">
                  <div className="h-14 bg-background border-b flex items-center justify-between px-4 pt-4">
                    <span className="font-medium text-sm">MornSpeaker</span>
                    <div className="flex gap-1">
                      <div className="w-1 h-1 rounded-full bg-foreground" />
                      <div className="w-1 h-1 rounded-full bg-foreground" />
                      <div className="w-1 h-1 rounded-full bg-foreground" />
                    </div>
                  </div>

                  <div className="flex-1 p-4 space-y-4 overflow-hidden relative">
                    {/* Chat bubbles */}
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex-shrink-0" />
                      <div className="bg-muted p-3 rounded-2xl rounded-tl-none max-w-[80%]">
                        <div className="w-32 h-2 bg-foreground/10 rounded mb-2" />
                        <div className="w-48 h-2 bg-foreground/10 rounded" />
                      </div>
                    </div>
                    <div className="flex gap-2 flex-row-reverse">
                      <div className="w-8 h-8 rounded-full bg-primary flex-shrink-0" />
                      <div className="bg-primary/10 p-3 rounded-2xl rounded-tr-none max-w-[80%]">
                        <div className="w-40 h-2 bg-primary/20 rounded mb-2" />
                        <div className="w-24 h-2 bg-primary/20 rounded" />
                      </div>
                    </div>

                    {/* Floating Action Button */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                      <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/30 animate-pulse">
                        <Mic className="w-8 h-8 text-white" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* QR Code Card floating */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -right-12 bottom-20 bg-white p-2 rounded-xl shadow-xl border border-border/10 hidden md:block w-40"
              >
                <div className="relative aspect-square w-full bg-slate-100 rounded-lg overflow-hidden mb-2">
                  <Image
                    src="/miniprogram-qrcode.png"
                    alt="Mini Program QR Code"
                    fill
                    className="object-cover"
                  />
                </div>
                <p className="text-xs text-center font-medium text-slate-600">扫码体验小程序</p>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 bg-primary/5 relative">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-4xl font-bold mb-8">准备好开始了吗？</h2>
          <p className="text-xl text-muted-foreground mb-12">
            立即升级您的沟通体验，让每一次对话都充满价值。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/room">
              <Button size="lg" className="text-lg px-8 py-6 rounded-full w-full sm:w-auto">
                <Sparkles className="mr-2 w-5 h-5" />
                立即进入会议室
              </Button>
            </Link>
            <Button variant="outline" size="lg" className="text-lg px-8 py-6 rounded-full w-full sm:w-auto">
              查看详细文档
            </Button>
          </div>
        </div>
      </section>

    </div>
  )
}

function DetailCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="flex gap-4 p-4 rounded-xl hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
      <div className="flex-shrink-0 w-12 h-12 rounded-full bg-background border shadow-sm flex items-center justify-center">
        {icon}
      </div>
      <div>
        <h3 className="font-bold text-lg mb-1">{title}</h3>
        <p className="text-muted-foreground leading-snug">{desc}</p>
      </div>
    </div>
  )
}

function PhoneOffIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="23" x2="1" y1="1" y2="23" />
    </svg>
  )
}
