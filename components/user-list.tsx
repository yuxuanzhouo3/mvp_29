"use client"

import { useState, useMemo } from "react"
import { Users, Globe, UserX, Phone, Copy, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/components/i18n-provider"
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

export type User = {
  id: string
  name: string
  sourceLanguage: string
  targetLanguage: string
  avatar: string
}

type UserListProps = {
  users: User[]
  currentUserId: string
  adminUserId?: string | null
  canKick?: boolean
  onKick?: (targetUserId: string) => void | Promise<void>
  onCall?: (targetUserId: string) => void | Promise<void>
  roomId?: string
}

export function UserList({ users, currentUserId, adminUserId = null, canKick = false, onKick, onCall, roomId }: UserListProps) {
  const { t, locale } = useI18n()
  const [copied, setCopied] = useState(false)

  const handleCopyInvite = () => {
    if (!roomId) return
    // Assuming the URL structure, or just copy the Room ID
    const url = typeof window !== 'undefined' ? `${window.location.origin}/room/${roomId}` : roomId
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale === 'zh' ? 'zh-CN' : locale === 'en' ? 'en-US' : locale], { type: 'language' })
    } catch {
      return null
    }
  }, [locale])

  const getLangInfo = (code: string) => {
    if (!code || code === "auto" || code === "自动识别") return { flag: "🌐", label: "Auto" }
    const c = code.toLowerCase()
    if (c.startsWith("zh")) return { flag: "🇨🇳", label: "ZH" }
    if (c.startsWith("en")) return { flag: "🇺🇸", label: "EN" }
    if (c.startsWith("ja")) return { flag: "🇯🇵", label: "JA" }
    if (c.startsWith("ko")) return { flag: "🇰🇷", label: "KO" }
    if (c.startsWith("fr")) return { flag: "🇫🇷", label: "FR" }
    if (c.startsWith("de")) return { flag: "🇩🇪", label: "DE" }
    if (c.startsWith("es")) return { flag: "🇪🇸", label: "ES" }
    if (c.startsWith("ru")) return { flag: "🇷🇺", label: "RU" }
    if (c.startsWith("pt")) return { flag: "🇵🇹", label: "PT" }
    if (c.startsWith("it")) return { flag: "🇮🇹", label: "IT" }
    if (c.startsWith("hi")) return { flag: "🇮🇳", label: "HI" }
    if (c.startsWith("id")) return { flag: "🇮🇩", label: "ID" }
    return { flag: "🌐", label: code.substring(0, 2).toUpperCase() }
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden border-0 shadow-none bg-transparent">
      <CardHeader className="pb-2 px-4 shrink-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
          {t("users.title", { count: users.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 overflow-y-auto min-h-0 px-2 py-3">
        {/* Voice Call Highlight Section */}
        <div className="bg-gradient-to-br from-primary/5 to-primary/0 rounded-xl p-3 border border-primary/10 shadow-sm">
           <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shadow-sm ring-1 ring-primary/5">
                 <Phone className="w-4 h-4" />
              </div>
              <div>
                 <h3 className="text-sm font-bold text-foreground tracking-tight">语音通话</h3>
                 <p className="text-[10px] text-muted-foreground font-medium">实时语音翻译通话</p>
              </div>
           </div>
           
           {users.length <= 1 ? (
             <div className="text-center py-1">
                <p className="text-xs text-muted-foreground/80 mb-3 font-medium">邀请好友加入后即可开始通话</p>
                {roomId && (
                  <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-2 bg-background/80 hover:bg-background border-dashed" onClick={handleCopyInvite}>
                    {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    {copied ? "已复制链接" : "复制邀请链接"}
                  </Button>
                )}
             </div>
           ) : (
             <div className="space-y-2">
                {users.filter(u => u.id !== currentUserId).map(u => (
                  <Button 
                    key={`call-${u.id}`}
                    variant="default" 
                    size="sm" 
                    className="w-full justify-between h-9 text-xs shadow-sm hover:shadow-md transition-all"
                    onClick={() => onCall && onCall(u.id)}
                  >
                    <span className="flex items-center gap-2">
                       <Avatar className="w-5 h-5 border border-white/20">
                          <AvatarImage src={u.avatar} />
                          <AvatarFallback className="text-[9px] bg-primary-foreground/10 text-primary-foreground">{u.name[0]}</AvatarFallback>
                       </Avatar>
                       <span className="truncate max-w-[120px]">呼叫 {u.name}</span>
                    </span>
                    <Phone className="w-3.5 h-3.5 ml-1 animate-pulse" />
                  </Button>
                ))}
             </div>
           )}
        </div>

        <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-wider px-1">
               在线用户 ({users.length})
            </h4>
            <div className="space-y-1">
              {users.map((user) => {
                const source = getLangInfo(user.sourceLanguage)
                const target = user.targetLanguage ? getLangInfo(user.targetLanguage) : null
                
                return (
                  <div key={user.id} className="group flex items-center gap-3 p-2 rounded-xl hover:bg-muted/60 transition-all duration-200">
                    <div className="relative shrink-0">
                      <Avatar className="w-10 h-10 border-2 border-background shadow-sm">
                        <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
                        <AvatarFallback className="bg-primary/5 text-primary text-xs font-bold">
                          {user.name[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {/* Online Status Indicator */}
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full shadow-sm ring-1 ring-background" />
                    </div>
                    
                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold truncate text-foreground/90">
                          {user.name}
                        </p>
                        {user.id === currentUserId && (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px] rounded-md font-medium text-muted-foreground/80 bg-muted">
                            {t("users.you")}
                          </Badge>
                        )}
                        {adminUserId && user.id === adminUserId && (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px] rounded-md font-medium text-amber-600/80 bg-amber-500/10">
                            ADMIN
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                        <span className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded-md border border-border/40">
                          <span className="text-[10px]">{source.flag}</span>
                          <span className="font-medium text-[10px]">{source.label}</span>
                        </span>
                        {target && (
                          <>
                            <span className="text-muted-foreground/40">→</span>
                            <span className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded-md border border-border/40">
                              <span className="text-[10px]">{target.flag}</span>
                              <span className="font-medium text-[10px]">{target.label}</span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Call button moved to top panel, but keeping a small one here for convenience if needed, 
                          OR removing it to reduce clutter as per 'Function Entry' request. 
                          I will remove it to force usage of the new panel and make it cleaner. 
                          Wait, if there are many users, the top panel might get crowded or need scrolling. 
                          But the user asked to redesign the entry.
                          Let's keep the small button but make it very subtle, or remove it. 
                          I'll remove it to declutter.
                      */}
                      
                      {canKick && onKick && user.id !== currentUserId && (!adminUserId || user.id !== adminUserId) && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 rounded-full text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                              aria-label={t("users.kick")}
                            >
                              <UserX className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("users.kickConfirmTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>{t("users.kickConfirmDesc")}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={(e) => {
                                  e.preventDefault()
                                  void onKick(user.id)
                                }}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                {t("users.kick")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
        </div>
      </CardContent>
    </Card>
  )
}
