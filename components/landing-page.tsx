"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, MonitorSpeaker, LogIn, LogOut, Smartphone, Monitor, Globe, Download, ChevronDown, Shield, Zap, Layout } from "lucide-react"
import Link from "next/link"
import { useI18n } from "@/components/i18n-provider"
import { UiLanguageSelector } from "@/components/ui-language-selector"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"
import { motion } from "framer-motion"
import { useEffect, useMemo, useState } from "react"

export function LandingPage({ showFull = true }: { showFull?: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [clientHideFull, setClientHideFull] = useState(false)
  const finalShowFull = useMemo(() => showFull && !clientHideFull, [showFull, clientHideFull])

  useEffect(() => {
    if (typeof window === "undefined") return
    const ua = navigator.userAgent.toLowerCase()
    const isApp =
      !!(window as any).median_status_checker ||
      !!(window as any).JSBridge ||
      ua.includes("median") ||
      ua.includes("gonative")
    const params = new URLSearchParams(window.location.search)
    const envParam = params.get("_wxjs_environment")
    const fromParam = params.get("from")
    const mpParam = params.get("mp")
    const isMiniProgram =
      ua.includes("miniprogram") ||
      envParam === "miniprogram" ||
      fromParam === "miniprogram" ||
      fromParam === "miniProgram" ||
      fromParam === "mp" ||
      mpParam === "1" ||
      mpParam === "true" ||
      (window as any).__wxjs_environment === "miniprogram"
    if (isApp || isMiniProgram) setClientHideFull(true)
  }, [])

  const handleLogout = async () => {
    await signOut()
    router.replace("/login")
  }

  const scrollToNextSection = () => {
    const element = document.getElementById('intro-section');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
      }
    }
  };

  const [releases, setReleases] = useState<Record<string, {
    available: boolean
    version?: string
    downloadUrl?: string
  }>>({})

  useEffect(() => {
    const platforms = ["android", "ios", "harmony", "windows", "macos", "linux", "chrome", "firefox"]
    let cancelled = false
    Promise.all(
      platforms.map((platform) =>
        fetch(`/api/releases?platform=${platform}`)
          .then((res) => res.json())
          .then((data) => [platform, data] as const)
          .catch(() => [platform, { available: false }] as const)
      )
    ).then((entries) => {
      if (cancelled) return
      const next: Record<string, { available: boolean; version?: string; downloadUrl?: string }> = {}
      for (const [platform, data] of entries) {
        next[platform] = data
      }
      setReleases(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const resolveItem = (platform: string, label: string) => {
    const release = releases[platform]
    if (release?.available) {
      return {
        label: release.version ? `${label} v${release.version}` : label,
        href: release.downloadUrl || `/api/downloads?platform=${platform}`,
        comingSoon: false,
      }
    }
    return { label, href: "#", comingSoon: true }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero Section */}
      <section className="min-h-screen flex flex-col relative">
        <div className="container mx-auto p-4 md:p-8 flex justify-between items-center z-10">
          <div className="flex items-center gap-4">
            {/* Logo or Brand Name could go here */}
            {user ? (
              <Button variant="ghost" size="sm" className="gap-2" onClick={handleLogout}>
                <LogOut className="w-4 h-4" />
                {t("common.logout")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="gap-2" onClick={() => router.push("/login")}>
                <LogIn className="w-4 h-4" />
                {t("admin.login")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <UiLanguageSelector />
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center items-center p-4 container mx-auto max-w-4xl">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-4xl md:text-6xl font-bold text-center mb-12 bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60"
          >
            {t("app.name")}
          </motion.h1>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid md:grid-cols-2 gap-6 w-full"
          >
            <motion.div variants={fadeInUp}>
              <Link href="/room" className="block group h-full">
                <Card className="h-full transition-all duration-300 hover:border-primary hover:shadow-xl cursor-pointer hover:-translate-y-1">
                  <CardHeader className="text-center">
                    <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4 group-hover:bg-primary/20 transition-colors">
                      <Users className="w-8 h-8 text-primary" />
                    </div>
                    <CardTitle>{t("dashboard.room.title")}</CardTitle>
                    <CardDescription>
                      {t("dashboard.room.desc")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                      <li>{t("dashboard.room.feature1")}</li>
                      <li>{t("dashboard.room.feature2")}</li>
                      <li>{t("dashboard.room.feature3")}</li>
                    </ul>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>

            <motion.div variants={fadeInUp}>
              <Link href="/system-audio" className="block group h-full">
                <Card className="h-full transition-all duration-300 hover:border-primary hover:shadow-xl cursor-pointer hover:-translate-y-1">
                  <CardHeader className="text-center">
                    <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4 group-hover:bg-primary/20 transition-colors">
                      <MonitorSpeaker className="w-8 h-8 text-primary" />
                    </div>
                    <CardTitle>{t("dashboard.system.title")}</CardTitle>
                    <CardDescription>
                      {t("dashboard.system.desc")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                      <li>{t("dashboard.system.feature1")}</li>
                      <li>{t("dashboard.system.feature2")}</li>
                      <li>{t("dashboard.system.feature3")}</li>
                    </ul>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          </motion.div>
        </div>

        {finalShowFull && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 cursor-pointer animate-bounce"
            onClick={scrollToNextSection}
          >
            <ChevronDown className="w-8 h-8 text-muted-foreground/50 hover:text-primary transition-colors" />
          </motion.div>
        )}
      </section>

      {finalShowFull && (
        <>
          <section id="intro-section" className="py-24 bg-muted/30 relative overflow-hidden">
            <div className="container mx-auto px-4 relative z-10">
              <motion.div
                {...fadeInUp}
                className="text-center max-w-3xl mx-auto mb-16"
              >
                <h2 className="text-3xl md:text-4xl font-bold mb-6">{t("landing.product.title")}</h2>
                <p className="text-xl text-muted-foreground leading-relaxed">
                  {t("landing.product.desc")}
                </p>
              </motion.div>

              <div className="grid md:grid-cols-3 gap-8">
                <FeatureCard
                  icon={<Zap className="w-10 h-10 text-yellow-500" />}
                  title={t("landing.features.realtime")}
                  desc={t("landing.features.realtimeDesc")}
                  delay={0.1}
                />
                <FeatureCard
                  icon={<Layout className="w-10 h-10 text-blue-500" />}
                  title={t("landing.features.crossPlatform")}
                  desc={t("landing.features.crossPlatformDesc")}
                  delay={0.2}
                />
                <FeatureCard
                  icon={<Shield className="w-10 h-10 text-green-500" />}
                  title={t("landing.features.secure")}
                  desc={t("landing.features.secureDesc")}
                  delay={0.3}
                />
              </div>
            </div>
          </section>

          <section className="py-24 bg-background">
            <div className="container mx-auto px-4 text-center">
              <motion.div {...fadeInUp} className="mb-16">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.download.title")}</h2>
                <p className="text-lg text-muted-foreground">{t("landing.download.subtitle")}</p>
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                <DownloadCard
                  title={t("landing.download.mobile")}
                  icon={<Smartphone className="w-12 h-12" />}
                  items={[
                    resolveItem("android", "Android"),
                    resolveItem("ios", "iOS"),
                    resolveItem("harmony", "HarmonyOS")
                  ]}
                  delay={0.1}
                />

                <DownloadCard
                  title={t("landing.download.desktop")}
                  icon={<Monitor className="w-12 h-12" />}
                  items={[
                    resolveItem("windows", "Windows"),
                    resolveItem("macos", "macOS"),
                    resolveItem("linux", "Linux")
                  ]}
                  delay={0.2}
                />

                <DownloadCard
                  title={t("landing.download.extension")}
                  icon={<Globe className="w-12 h-12" />}
                  items={[
                    resolveItem("chrome", "Chrome / Edge"),
                    resolveItem("firefox", "Firefox")
                  ]}
                  delay={0.3}
                />
              </div>
            </div>
          </section>

          <footer className="py-8 border-t text-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} MornSpeaker. All rights reserved.</p>
          </footer>
        </>
      )}
    </div>
  )
}

function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode, title: string, desc: string, delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className="bg-card p-8 rounded-2xl shadow-sm border hover:shadow-md transition-shadow"
    >
      <div className="mb-6 bg-secondary/50 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-3 text-center">{title}</h3>
      <p className="text-muted-foreground text-center">{desc}</p>
    </motion.div>
  )
}

function DownloadCard({ title, icon, items, delay }: { title: string, icon: React.ReactNode, items: { label: string, href: string, comingSoon?: boolean }[], delay: number }) {
  const { t } = useI18n()

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className="bg-card p-8 rounded-2xl border hover:border-primary/50 transition-colors flex flex-col items-center"
    >
      <div className="mb-6 text-primary">
        {icon}
      </div>
      <h3 className="text-2xl font-semibold mb-8">{title}</h3>

      <div className="w-full space-y-3">
        {items.map((item, idx) => (
          <Button key={idx} variant="outline" className="w-full justify-between group" asChild={!item.comingSoon} disabled={item.comingSoon}>
            {item.comingSoon ? (
              <div className="w-full flex justify-between items-center opacity-70">
                <span>{item.label}</span>
                <span className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">{t("landing.download.comingSoon")}</span>
              </div>
            ) : (
              <a href={item.href} className="w-full flex justify-between items-center">
                <span>{item.label}</span>
                <Download className="w-4 h-4 group-hover:translate-y-1 transition-transform" />
              </a>
            )}
          </Button>
        ))}
      </div>
    </motion.div>
  )
}
