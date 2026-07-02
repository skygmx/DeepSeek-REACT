import type { ChatMessage, Conversation } from '../types/chat'

export interface ApiConversation {
  id: string
  title: string
  status: string
  mode: string
  messageCount: number
  lastMessageAt: number | null
  updatedAt: number | null
  createdAt: number | null
}

export interface ApiMessage {
  id: string
  conversationId: string
  role: ChatMessage['role']
  kind: ChatMessage['kind']
  content: string
  contentFormat: ChatMessage['contentFormat']
  status: ChatMessage['status']
  timestamp: number | null
  completedAt: number | null
  toolName?: string | null
  metadata?: Record<string, unknown>
}

interface SessionResponse {
  user: {
    id: string
    email: string | null
    displayName: string
    avatarUrl: string | null
  }
  workspace: {
    id: string
    name: string
    role: string
  }
}

const API_BASE_URL =
  import.meta.env.VITE_DEEPSEEK_API_URL ??
  `http://${window.location.hostname}:3000/api`

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '请求失败'
  if (!('message' in payload)) return '请求失败'

  return typeof payload.message === 'string' ? payload.message : '请求失败'
}

async function requestJson<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  const payload = (await response.json()) as T | { message?: string }
  if (!response.ok) {
    throw new Error(getErrorMessage(payload))
  }

  return payload as T
}

export function mapApiConversation(
  conversation: ApiConversation,
  messages: ChatMessage[] = [],
): Conversation {
  return {
    id: conversation.id,
    messagelist: messages,
    messageCount: conversation.messageCount,
    mode: conversation.mode,
    status: conversation.status,
    timeStamp:
      conversation.lastMessageAt ??
      conversation.updatedAt ??
      conversation.createdAt ??
      Date.now(),
    tittle: conversation.title,
  }
}

export function mapApiMessage(message: ApiMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content,
    contentFormat: message.contentFormat,
    status: message.status,
    timestamp: message.timestamp ?? Date.now(),
    completedAt: message.completedAt,
    toolName: message.toolName,
    metadata: message.metadata,
  }
}

export async function fetchSession() {
  return requestJson<SessionResponse>('/session')
}

export async function fetchConversations() {
  const payload = await requestJson<{ conversations: ApiConversation[] }>(
    '/conversations',
  )
  return payload.conversations.map((conversation) =>
    mapApiConversation(conversation),
  )
}

export async function createConversation() {
  const payload = await requestJson<{ conversation: ApiConversation }>(
    '/conversations',
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  )
  return mapApiConversation(payload.conversation)
}

export async function fetchConversationMessages(conversationId: string) {
  const payload = await requestJson<{
    conversation: ApiConversation
    messages: ApiMessage[]
  }>(`/conversations/${conversationId}/messages`)

  const messages = payload.messages.map(mapApiMessage)
  return {
    conversation: mapApiConversation(payload.conversation, messages),
    messages,
  }
}
