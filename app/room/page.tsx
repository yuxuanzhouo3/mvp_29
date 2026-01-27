import { VoiceChatInterface } from "@/components/voice-chat-interface"
import { AuthRequired } from "@/components/auth-required"

export default function RoomPage() {
  return (
    <main className="min-h-screen bg-background">
      <AuthRequired>
        <VoiceChatInterface />
      </AuthRequired>
    </main>
  )
}
