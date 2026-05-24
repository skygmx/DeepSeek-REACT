export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  timestamp: number
}

export interface Conversation {
  id: string
  messagelist: ChatMessage[]
  timeStamp: number
  tittle: string
}

export interface LlmMessage {
  role: ChatRole
  content: string
}

export type StoredConversationEntry = [string, Conversation]

