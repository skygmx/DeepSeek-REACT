import { useCallback, useEffect, useRef, useState } from 'react'
import {
  mapApiConversation,
  mapApiMessage,
  type ApiConversation,
  type ApiMessage,
} from '../api/chatApi'
import type { ChatMessage, Conversation } from '../types/chat'

interface UseWebSocketChatOptions {
  conversationId?: string
  appendMessage: (message: ChatMessage, conversationId?: string) => void
  updateConversation: (conversation: Conversation) => void
  updateAssistantMessage: (
    id: string,
    content: string,
    conversationId?: string,
  ) => void
}

type ServerMessage =
  | {
      type: 'chat:accepted'
      requestId: string
      assistantMessage: ApiMessage
      conversation: ApiConversation
      userMessage: ApiMessage
    }
  | { type: 'chat:delta'; requestId: string; content: string }
  | { type: 'chat:done'; requestId: string }
  | { type: 'chat:cancelled'; requestId: string }
  | { type: 'chat:error'; requestId?: string; message: string }

const WS_ENDPOINT =
  import.meta.env.VITE_DEEPSEEK_WS_URL ?? `ws://${window.location.hostname}:3000/ws/chat`

function parseServerMessage(data: MessageEvent['data']) {
  if (typeof data !== 'string') return null

  try {
    return JSON.parse(data) as ServerMessage
  } catch {
    return null
  }
}

function isTerminalMessage(type: ServerMessage['type']) {
  return type === 'chat:done' || type === 'chat:cancelled' || type === 'chat:error'
}

export function useWebSocketChat({
  conversationId,
  appendMessage,
  updateConversation,
  updateAssistantMessage,
}: UseWebSocketChatOptions) {
  const [loading, setLoading] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const activeRequestRef = useRef<{
    assistantId: string | null
    conversationId: string
    requestId: string
  } | null>(null)
  const pendingAssistantContentRef = useRef('')
  const flushFrameRef = useRef<number | null>(null)

  const clearFlushFrame = useCallback(() => {
    if (flushFrameRef.current === null) return

    window.cancelAnimationFrame(flushFrameRef.current)
    flushFrameRef.current = null
  }, [])

  const flushPendingAssistantContent = useCallback(
    (assistantId: string, targetConversationId: string) => {
      const content = pendingAssistantContentRef.current
      if (!content) return

      pendingAssistantContentRef.current = ''
      clearFlushFrame()
      updateAssistantMessage(assistantId, content, targetConversationId)
    },
    [clearFlushFrame, updateAssistantMessage],
  )

  const resetPendingAssistantContent = useCallback(() => {
    pendingAssistantContentRef.current = ''
    clearFlushFrame()
  }, [clearFlushFrame])

  const queueAssistantContent = useCallback(
    (assistantId: string, content: string, targetConversationId: string) => {
      pendingAssistantContentRef.current += content
      if (flushFrameRef.current !== null) return

      flushFrameRef.current = window.requestAnimationFrame(() => {
        flushFrameRef.current = null
        flushPendingAssistantContent(assistantId, targetConversationId)
      })
    },
    [flushPendingAssistantContent],
  )

  const closeSocket = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
    activeRequestRef.current = null
    resetPendingAssistantContent()
    setLoading(false)
  }, [resetPendingAssistantContent])

  const cancelRequest = useCallback(() => {
    const activeRequest = activeRequestRef.current
    const socket = socketRef.current

    if (activeRequest?.assistantId) {
      flushPendingAssistantContent(
        activeRequest.assistantId,
        activeRequest.conversationId,
      )
    }

    if (activeRequest && socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'chat:cancel',
          requestId: activeRequest.requestId,
        }),
      )
    }

    closeSocket()
  }, [closeSocket, flushPendingAssistantContent])

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim()
      if (!message || loading || !conversationId) return false

      const requestId = crypto.randomUUID()

      closeSocket()
      setLoading(true)
      activeRequestRef.current = {
        assistantId: null,
        conversationId,
        requestId,
      }

      return new Promise<boolean>((resolve) => {
        let settled = false
        const socket = new WebSocket(WS_ENDPOINT)
        socketRef.current = socket

        const finish = (result: boolean) => {
          if (settled) return
          settled = true
          setLoading(false)
          activeRequestRef.current = null
          socketRef.current = null
          resolve(result)
        }

        socket.addEventListener('open', () => {
          socket.send(
            JSON.stringify({
              type: 'chat:start',
              requestId,
              conversationId,
              message,
            }),
          )
        })

        socket.addEventListener('message', (event) => {
          const payload = parseServerMessage(event.data)
          if (!payload) return
          if (payload.requestId && payload.requestId !== requestId) return

          if (payload.type === 'chat:accepted') {
            const conversation = mapApiConversation(payload.conversation)
            const userMessage = mapApiMessage(payload.userMessage)
            const assistantMessage = mapApiMessage(payload.assistantMessage)

            updateConversation(conversation)
            appendMessage(userMessage, conversation.id)
            appendMessage(assistantMessage, conversation.id)
            activeRequestRef.current = {
              assistantId: assistantMessage.id,
              conversationId: conversation.id,
              requestId,
            }
            return
          }

          if (payload.type === 'chat:delta') {
            const assistantId = activeRequestRef.current?.assistantId
            if (!assistantId) return

            queueAssistantContent(assistantId, payload.content, conversationId)
            return
          }

          if (payload.type === 'chat:error') {
            const assistantId = activeRequestRef.current?.assistantId
            const targetConversationId = activeRequestRef.current?.conversationId
            if (assistantId && targetConversationId) {
              flushPendingAssistantContent(assistantId, targetConversationId)
              updateAssistantMessage(
                assistantId,
                `连接失败：${payload.message}`,
                targetConversationId,
              )
            }
          }

          if (isTerminalMessage(payload.type)) {
            const assistantId = activeRequestRef.current?.assistantId
            const targetConversationId = activeRequestRef.current?.conversationId
            if (assistantId && targetConversationId) {
              flushPendingAssistantContent(assistantId, targetConversationId)
            }
            socket.close()
            finish(payload.type === 'chat:done')
          }
        })

        socket.addEventListener('error', () => {
          const assistantId = activeRequestRef.current?.assistantId
          const targetConversationId = activeRequestRef.current?.conversationId
          if (assistantId && targetConversationId) {
            flushPendingAssistantContent(assistantId, targetConversationId)
            updateAssistantMessage(
              assistantId,
              '连接失败：WebSocket 连接异常',
              targetConversationId,
            )
          }
          finish(false)
        })

        socket.addEventListener('close', () => {
          if (!settled) {
            const assistantId = activeRequestRef.current?.assistantId
            const targetConversationId = activeRequestRef.current?.conversationId
            if (assistantId && targetConversationId) {
              flushPendingAssistantContent(assistantId, targetConversationId)
              updateAssistantMessage(
                assistantId,
                '连接失败：WebSocket 连接已关闭',
                targetConversationId,
              )
            }
            finish(false)
          }
        })
      })
    },
    [
      appendMessage,
      closeSocket,
      conversationId,
      flushPendingAssistantContent,
      loading,
      queueAssistantContent,
      updateConversation,
      updateAssistantMessage,
    ],
  )

  useEffect(() => closeSocket, [closeSocket])

  return {
    loading,
    cancelRequest,
    sendMessage,
  }
}
