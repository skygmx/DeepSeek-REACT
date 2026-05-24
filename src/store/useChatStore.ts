import { useContext } from 'react'
import { ChatContext } from './chatContext'

export function useChatStore() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatStore 必须在 ChatProvider 内使用')
  }
  return context
}
