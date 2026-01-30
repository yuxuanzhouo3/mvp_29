"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, MonitorSpeaker, LogIn, LogOut } from "lucide-react"
import Link from "next/link"
import { useI18n } from "@/components/i18n-provider"
import { UiLanguageSelector } from "@/components/ui-language-selector"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"

export function Dashboard() {
  const { t } = useI18n()
  const router = useRouter()
  const { user, signOut } = useAuth()

  const handleLogout = async () => {
    await signOut()
    router.replace("/login")
  }

  return (
    <div className="container mx-auto p-4 md:p-8 min-h-screen flex flex-col max-w-4xl">
      <div className="flex justify-between items-center mb-8">
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
        <UiLanguageSelector />
      </div>

      <div className="flex-1 flex flex-col justify-center pb-20">
        <h1 className="text-3xl font-bold text-center mb-8">{t("app.name")}</h1>

        <div className="grid md:grid-cols-2 gap-6">
          <Link href="/room" className="block group">
            <Card className="h-full transition-all hover:border-primary hover:shadow-lg cursor-pointer">
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

          <Link href="/system-audio" className="block group">
            <Card className="h-full transition-all hover:border-primary hover:shadow-lg cursor-pointer">
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
        </div>
      </div>
    </div>
  )
}
