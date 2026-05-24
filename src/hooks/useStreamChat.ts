import { createParser } from 'eventsource-parser'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LlmMessage } from '../types/chat'

interface UseStreamChatOptions {
  getHistory: () => LlmMessage[]
  addUserMessage: (content: string) => void
  addAssistantMessage: () => string
  updateAssistantMessage: (id: string, content: string) => void
  renameConversationFromFirstMessage: (content: string) => void
}

interface DeepSeekStreamData {
  error?: string
  choices?: Array<{
    delta?: {
      content?: string
    }
  }>
}

const STREAM_ENDPOINT = 'http://localhost:3000/api/deepseek/stream'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误'
}

function parseStreamData(data: string) {
  try {
    return JSON.parse(data) as DeepSeekStreamData
  } catch {
    return data
  }
}

export function useStreamChat({
  getHistory,
  addUserMessage,
  addAssistantMessage,
  updateAssistantMessage,
  renameConversationFromFirstMessage,
}: UseStreamChatOptions) {
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const cancelRequest = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setLoading(false)
  }, [])

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim()
      if (!message || loading) return false

      const history = getHistory()
      addUserMessage(message)
      renameConversationFromFirstMessage(message)
      const assistantId = addAssistantMessage()

      cancelRequest()
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      setLoading(true)

      try {
        const response = await fetch(STREAM_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            history,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) throw new Error(`请求失败：${response.status}`)
        if (!response.body) throw new Error('服务器不支持流式响应')

        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        const parser = createParser({
          onEvent(event) {
            if (event.data === '[DONE]') return

            const parsed = parseStreamData(event.data)
            if (typeof parsed === 'string') {
              updateAssistantMessage(assistantId, parsed)
              return
            }

            if (parsed.error) {
              updateAssistantMessage(assistantId, `连接失败：${parsed.error}`)
              return
            }

            const content = parsed.choices?.[0]?.delta?.content ?? ''
            if (content) {
              updateAssistantMessage(assistantId, content)
            }
          },
          onError(error) {
            console.error('SSE 协议错误：', error)
          },
        })

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          parser.feed(decoder.decode(value, { stream: true }))
        }

        return true
      } catch (error) {
        if (getErrorMessage(error) !== 'AbortError') {
          updateAssistantMessage(
            assistantId,
            `连接失败：${getErrorMessage(error)}`,
          )
          console.error('请求异常：', error)
        }
        return false
      } finally {
        setLoading(false)
        abortControllerRef.current = null
      }
    },
    [
      addAssistantMessage,
      addUserMessage,
      cancelRequest,
      getHistory,
      loading,
      renameConversationFromFirstMessage,
      updateAssistantMessage,
    ],
  )

  useEffect(() => cancelRequest, [cancelRequest])

  return {
    loading,
    cancelRequest,
    sendMessage,
  }
}

