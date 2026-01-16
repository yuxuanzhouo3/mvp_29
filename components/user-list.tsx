"use client"

import { Users, Globe } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/components/i18n-provider"

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
}

export function UserList({ users, currentUserId }: UserListProps) {
  const { t } = useI18n()
  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" />
          {t("users.title", { count: users.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 overflow-y-auto min-h-0">
        {users.map((user) => (
          <div key={user.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <Avatar className="w-10 h-10">
              <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
              <AvatarFallback>{user.name[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">
                  {user.name}
                  {user.id === currentUserId && <span className="text-xs text-muted-foreground ml-1">{t("users.you")}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <Globe className="w-3 h-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {user.sourceLanguage} → {user.targetLanguage}
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="text-xs">
              {t("users.online")}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
