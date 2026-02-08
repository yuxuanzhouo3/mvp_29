import { VoiceChatInterface } from "@/components/voice-chat-interface"
import { AuthRequired } from "@/components/auth-required"

export default function RoomByIdPage({ params }: { params: { roomId: string } }) {
  const initialRoomId = typeof params?.roomId === "string" ? params.roomId : null
  return (
    <main className="min-h-screen bg-background">
      <AuthRequired>
        <VoiceChatInterface initialRoomId={initialRoomId} autoJoin={Boolean(initialRoomId)} />
      </AuthRequired>
    </main>
  )
}
