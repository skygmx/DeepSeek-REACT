import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { ChatMessage, Conversation, LlmMessage } from '../types/chat'
import { loadConversations, saveConversations } from '../utils/conversationStorage'
import { createId } from '../utils/ids'
import { ChatContext } from './chatContext'

interface ChatState {
  conversations: Record<string, Conversation>
  currentId: string
}

export interface ChatContextValue {
  conversations: Record<string, Conversation>
  conversationList: Conversation[]
  currentConversation: Conversation
  recentMessages: ChatMessage[]
  inputMessage: string
  setInputMessage: (value: string) => void
  addConversation: () => void
  switchConversation: (id: string) => void
  addUserMessage: (content: string) => void
  addAssistantMessage: () => string
  updateAssistantMessage: (id: string, content: string) => void
  renameConversationFromFirstMessage: (content: string) => void
  formatMessagesForLLM: () => LlmMessage[]
}

type ChatAction =
  | { type: 'addConversation'; conversation: Conversation }
  | { type: 'switchConversation'; id: string }
  | { type: 'addMessage'; message: ChatMessage }
  | { type: 'appendAssistantContent'; id: string; content: string }
  | { type: 'renameCurrent'; title: string }

function createConversation(title = '新的对话'): Conversation {
  const timestamp = Date.now()

  return {
    id: createId('conversation'),
    messagelist: [],
    timeStamp: timestamp,
    tittle: title,
  }
}

function createInitialState(): ChatState {
  const stored = loadConversations()
  if (stored) {
    const [currentId] = Object.keys(stored).sort(
      (a, b) => stored[b].timeStamp - stored[a].timeStamp,
    )
    return { conversations: stored, currentId }
  }

  const conversation = createConversation()
  return {
    conversations: { [conversation.id]: conversation },
    currentId: conversation.id,
  }
}

function updateCurrentConversation(
  state: ChatState,
  updater: (conversation: Conversation) => Conversation,
) {
  const currentConversation = state.conversations[state.currentId]
  if (!currentConversation) return state

  return {
    ...state,
    conversations: {
      ...state.conversations,
      [state.currentId]: updater(currentConversation),
    },
  }
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'addConversation':
      return {
        conversations: {
          ...state.conversations,
          [action.conversation.id]: action.conversation,
        },
        currentId: action.conversation.id,
      }
    case 'switchConversation':
      if (!state.conversations[action.id]) return state
      return { ...state, currentId: action.id }
    case 'addMessage':
      return updateCurrentConversation(state, (conversation) => ({
        ...conversation,
        messagelist: [...conversation.messagelist, action.message],
        timeStamp: Date.now(),
      }))
    case 'appendAssistantContent':
      return updateCurrentConversation(state, (conversation) => ({
        ...conversation,
        messagelist: conversation.messagelist.map((message) =>
          message.id === action.id
            ? { ...message, content: message.content + action.content }
            : message,
        ),
        timeStamp: Date.now(),
      }))
    case 'renameCurrent':
      return updateCurrentConversation(state, (conversation) => ({
        ...conversation,
        tittle: action.title,
      }))
    default:
      return state
  }
}

export function ChatProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState)
  const [inputMessage, setInputMessage] = useState('')

  const currentConversation =
    state.conversations[state.currentId] ?? Object.values(state.conversations)[0]

  useEffect(() => {
    saveConversations(state.conversations)
  }, [state.conversations])

  const conversationList = useMemo(
    () =>
      Object.values(state.conversations).sort(
        (a, b) => b.timeStamp - a.timeStamp,
      ),
    [state.conversations],
  )

  const recentMessages = useMemo(
    () =>
      [...currentConversation.messagelist].sort(
        (a, b) => a.timestamp - b.timestamp,
      ),
    [currentConversation.messagelist],
  )

  const addConversation = useCallback(() => {
    dispatch({ type: 'addConversation', conversation: createConversation() })
    setInputMessage('')
  }, [])

  const switchConversation = useCallback((id: string) => {
    dispatch({ type: 'switchConversation', id })
    setInputMessage('')
  }, [])

  const addUserMessage = useCallback((content: string) => {
    dispatch({
      type: 'addMessage',
      message: {
        id: createId('user'),
        role: 'user',
        content,
        timestamp: Date.now(),
      },
    })
  }, [])

  const addAssistantMessage = useCallback(() => {
    const id = createId('assistant')
    dispatch({
      type: 'addMessage',
      message: {
        id,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      },
    })
    return id
  }, [])

  const updateAssistantMessage = useCallback((id: string, content: string) => {
    dispatch({ type: 'appendAssistantContent', id, content })
  }, [])

  const renameConversationFromFirstMessage = useCallback(
    (content: string) => {
      if (currentConversation.messagelist.length > 1) return

      dispatch({
        type: 'renameCurrent',
        title: content.trim().slice(0, 18) || '新的对话',
      })
    },
    [currentConversation.messagelist.length],
  )

  const formatMessagesForLLM = useCallback(
    () =>
      currentConversation.messagelist.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [currentConversation.messagelist],
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations: state.conversations,
      conversationList,
      currentConversation,
      recentMessages,
      inputMessage,
      setInputMessage,
      addConversation,
      switchConversation,
      addUserMessage,
      addAssistantMessage,
      updateAssistantMessage,
      renameConversationFromFirstMessage,
      formatMessagesForLLM,
    }),
    [
      state.conversations,
      conversationList,
      currentConversation,
      recentMessages,
      inputMessage,
      addConversation,
      switchConversation,
      addUserMessage,
      addAssistantMessage,
      updateAssistantMessage,
      renameConversationFromFirstMessage,
      formatMessagesForLLM,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
