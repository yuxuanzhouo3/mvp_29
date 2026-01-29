import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { AuthProvider } from "@/components/auth-provider"
import { I18nProvider } from "@/components/i18n-provider"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { Toaster } from "@/components/ui/toaster"

export const metadata: Metadata = {
  title: 'MornSpeaker',
  description: 'MornSpeaker - AI 驱动的实时语音翻译应用',
  generator: 'v0.app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <AuthProvider>
          <I18nProvider>{children}</I18nProvider>
        </AuthProvider>
        <Toaster />
        <SonnerToaster />
        {process.env.NEXT_PUBLIC_DEPLOY_TARGET !== 'tencent' && <Analytics />}
      </body>
    </html>
  )
}
