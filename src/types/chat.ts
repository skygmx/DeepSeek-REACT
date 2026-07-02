export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageKind =
  | 'message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'workflow_status'
export type MessageStatus =
  | 'queued'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ChatMessage {
  id: string
  role: ChatRole
  kind: MessageKind
  content: string
  contentFormat: 'text' | 'markdown' | 'json'
  status: MessageStatus
  timestamp: number
  completedAt: number | null
  toolName?: string | null
  metadata?: Record<string, unknown>
}

export interface Conversation {
  id: string
  messagelist: ChatMessage[]
  messageCount: number
  mode: string
  status: string
  timeStamp: number
  tittle: string
}

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export type StoredConversationEntry = [string, Conversation]
