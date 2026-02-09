import { VoiceChatInterface } from "@/components/voice-chat-interface"
import { AuthRequired } from "@/components/auth-required"

export default async function RoomPage(props: { searchParams: Promise<{ roomId?: string }> }) {
  const searchParams = await props.searchParams
  const initialRoomId = typeof searchParams?.roomId === "string" ? searchParams.roomId : null
  return (
    <main className="min-h-screen bg-background">
      <AuthRequired>
        <VoiceChatInterface initialRoomId={initialRoomId} autoJoin={Boolean(initialRoomId)} />
      </AuthRequired>
    </main>
  )
}
