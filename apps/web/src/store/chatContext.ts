import { createContext } from 'react'
import type { ChatContextValue } from './chatStore'

export const ChatContext = createContext<ChatContextValue | null>(null)

