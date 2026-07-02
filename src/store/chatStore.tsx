import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { PropsWithChildren } from 'react'
import {
  createConversation as createRemoteConversation,
  fetchConversationMessages,
  fetchConversations,
  fetchSession,
} from '../api/chatApi'
import type { ChatMessage, Conversation } from '../types/chat'
import { ChatContext } from './chatContext'
import { chatReducer, initialState } from './chatReducer'

export interface ChatContextValue {
  conversations: Record<string, Conversation>
  conversationList: Conversation[]
  currentConversation: Conversation | null
  recentMessages: ChatMessage[]
  inputMessage: string
  isInitializing: boolean
  error: string | null
  setInputMessage: (value: string) => void
  addConversation: () => Promise<void>
  switchConversation: (id: string) => Promise<void>
  appendMessage: (message: ChatMessage, conversationId?: string) => void
  updateConversation: (conversation: Conversation) => void
  updateAssistantMessage: (
    id: string,
    content: string,
    conversationId?: string,
  ) => void
}

export function ChatProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(chatReducer, initialState)
  const [inputMessage, setInputMessage] = useState('')

  const loadConversationMessages = useCallback(async (conversationId: string) => {
    const result = await fetchConversationMessages(conversationId)
    dispatch({
      type: 'setConversationMessages',
      conversation: result.conversation,
    })
  }, [])

  const initializeChat = useCallback(async () => {
    try {
      dispatch({ type: 'setError', error: null })
      await fetchSession()

      const conversations = await fetchConversations()
      const firstConversation =
        conversations[0] ?? (await createRemoteConversation())

      dispatch({
        type: 'setConversations',
        conversations: conversations.length ? conversations : [firstConversation],
        currentId: firstConversation.id,
      })
      await loadConversationMessages(firstConversation.id)
    } catch (error) {
      dispatch({
        type: 'setError',
        error: error instanceof Error ? error.message : '初始化失败',
      })
    } finally {
      dispatch({ type: 'setInitialized', initialized: true })
    }
  }, [loadConversationMessages])

  useEffect(() => {
    void initializeChat()
  }, [initializeChat])

  const conversationList = useMemo(
    () =>
      Object.values(state.conversations).sort(
        (a, b) => b.timeStamp - a.timeStamp,
      ),
    [state.conversations],
  )

  const currentConversation = state.currentId
    ? state.conversations[state.currentId] ?? null
    : null

  const recentMessages = useMemo(
    () =>
      currentConversation
        ? [...currentConversation.messagelist].sort(
            (a, b) => a.timestamp - b.timestamp,
          )
        : [],
    [currentConversation],
  )

  const addConversation = useCallback(async () => {
    const conversation = await createRemoteConversation()
    dispatch({ type: 'upsertConversation', conversation })
    dispatch({
      type: 'setConversationMessages',
      conversation: { ...conversation, messagelist: [] },
    })
    setInputMessage('')
  }, [])

  const switchConversation = useCallback(
    async (id: string) => {
      if (id === state.currentId) return

      dispatch({ type: 'setCurrentId', id })
      setInputMessage('')
      await loadConversationMessages(id)
    },
    [loadConversationMessages, state.currentId],
  )

  const appendMessage = useCallback(
    (message: ChatMessage, conversationId = state.currentId) => {
      if (!conversationId) return
      dispatch({ type: 'appendMessage', conversationId, message })
    },
    [state.currentId],
  )

  const updateConversation = useCallback((conversation: Conversation) => {
    dispatch({ type: 'upsertConversation', conversation })
  }, [])

  const updateAssistantMessage = useCallback(
    (id: string, content: string, conversationId = state.currentId) => {
      if (!conversationId) return
      dispatch({ type: 'appendAssistantContent', conversationId, content, id })
    },
    [state.currentId],
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations: state.conversations,
      conversationList,
      currentConversation,
      recentMessages,
      inputMessage,
      isInitializing: !state.initialized,
      error: state.error,
      setInputMessage,
      addConversation,
      switchConversation,
      appendMessage,
      updateConversation,
      updateAssistantMessage,
    }),
    [
      state.conversations,
      state.initialized,
      state.error,
      conversationList,
      currentConversation,
      recentMessages,
      inputMessage,
      addConversation,
      switchConversation,
      appendMessage,
      updateConversation,
      updateAssistantMessage,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
