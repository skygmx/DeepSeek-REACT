import { useCallback, useEffect, useRef, useState } from 'react'
import type { LlmMessage } from '../types/chat'
import { createId } from '../utils/ids'

interface UseWebSocketChatOptions {
  getHistory: () => LlmMessage[]
  addUserMessage: (content: string) => void
  addAssistantMessage: () => string
  updateAssistantMessage: (id: string, content: string) => void
  renameConversationFromFirstMessage: (content: string) => void
}

type ServerMessage =
  | { type: 'chat:accepted'; requestId: string }
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
  getHistory,
  addUserMessage,
  addAssistantMessage,
  updateAssistantMessage,
  renameConversationFromFirstMessage,
}: UseWebSocketChatOptions) {
  const [loading, setLoading] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const activeRequestRef = useRef<{
    assistantId: string
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
    (assistantId: string) => {
      const content = pendingAssistantContentRef.current
      if (!content) return

      pendingAssistantContentRef.current = ''
      clearFlushFrame()
      updateAssistantMessage(assistantId, content)
    },
    [clearFlushFrame, updateAssistantMessage],
  )

  const resetPendingAssistantContent = useCallback(() => {
    pendingAssistantContentRef.current = ''
    clearFlushFrame()
  }, [clearFlushFrame])

  const queueAssistantContent = useCallback(
    (assistantId: string, content: string) => {
      pendingAssistantContentRef.current += content
      if (flushFrameRef.current !== null) return

      flushFrameRef.current = window.requestAnimationFrame(() => {
        flushFrameRef.current = null
        flushPendingAssistantContent(assistantId)
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

    if (activeRequest) {
      flushPendingAssistantContent(activeRequest.assistantId)
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
      if (!message || loading) return false

      const history = getHistory()
      addUserMessage(message)
      renameConversationFromFirstMessage(message)
      const assistantId = addAssistantMessage()
      const requestId = createId('request')

      closeSocket()
      setLoading(true)
      activeRequestRef.current = { assistantId, requestId }

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
              message,
              history,
            }),
          )
        })

        socket.addEventListener('message', (event) => {
          const payload = parseServerMessage(event.data)
          if (!payload) return
          if (payload.requestId && payload.requestId !== requestId) return

          if (payload.type === 'chat:delta') {
            queueAssistantContent(assistantId, payload.content)
            return
          }

          if (payload.type === 'chat:error') {
            flushPendingAssistantContent(assistantId)
            updateAssistantMessage(assistantId, `连接失败：${payload.message}`)
          }

          if (isTerminalMessage(payload.type)) {
            flushPendingAssistantContent(assistantId)
            socket.close()
            finish(payload.type === 'chat:done')
          }
        })

        socket.addEventListener('error', () => {
          flushPendingAssistantContent(assistantId)
          updateAssistantMessage(assistantId, '连接失败：WebSocket 连接异常')
          finish(false)
        })

        socket.addEventListener('close', () => {
          if (!settled) {
            flushPendingAssistantContent(assistantId)
            updateAssistantMessage(assistantId, '连接失败：WebSocket 连接已关闭')
            finish(false)
          }
        })
      })
    },
    [
      addAssistantMessage,
      addUserMessage,
      closeSocket,
      flushPendingAssistantContent,
      getHistory,
      loading,
      queueAssistantContent,
      renameConversationFromFirstMessage,
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
