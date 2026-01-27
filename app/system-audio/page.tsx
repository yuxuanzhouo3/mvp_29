import { SystemAudioInterface } from "@/components/system-audio-interface"
import { AuthRequired } from "@/components/auth-required"

export default function SystemAudioPage() {
  return (
    <main className="min-h-screen bg-background">
      <AuthRequired>
        <SystemAudioInterface />
      </AuthRequired>
    </main>
  )
}
