export interface User {
  id: string
  name: string
  sourceLanguage: string
  targetLanguage: string
  avatar: string
}

export interface Message {
  id: string
  userId: string
  userName: string
  originalText: string
  originalLanguage: string
  targetLanguage?: string
  translatedText?: string
  timestamp: string
  audioUrl?: string
}

export interface RoomData {
  id: string
  users: User[]
  messages: Message[]
}

export interface RoomStore {
  joinRoom(roomId: string, user: User): Promise<RoomData>
  leaveRoom(roomId: string, userId: string): Promise<void>
  sendMessage(roomId: string, message: Message): Promise<Message>
  getRoom(roomId: string): Promise<RoomData | null>
}
