import type { ChatMessage, Conversation } from '../types/chat'

export interface ChatState {
  conversations: Record<string, Conversation>
  currentId: string
  error: string | null
  initialized: boolean
}

export type ChatAction =
  | { type: 'setInitialized'; initialized: boolean }
  | { type: 'setError'; error: string | null }
  | { type: 'setConversations'; conversations: Conversation[]; currentId: string }
  | { type: 'setCurrentId'; id: string }
  | { type: 'setConversationMessages'; conversation: Conversation }
  | { type: 'upsertConversation'; conversation: Conversation }
  | { type: 'appendMessage'; conversationId: string; message: ChatMessage }
  | {
      type: 'appendAssistantContent'
      conversationId: string
      content: string
      id: string
    }

export const initialState: ChatState = {
  conversations: {},
  currentId: '',
  error: null,
  initialized: false,
}

function toConversationRecord(conversations: Conversation[]) {
  return conversations.reduce<Record<string, Conversation>>(
    (result, conversation) => {
      result[conversation.id] = conversation
      return result
    },
    {},
  )
}

function upsertConversation(
  conversations: Record<string, Conversation>,
  conversation: Conversation,
) {
  const existing = conversations[conversation.id]

  return {
    ...conversations,
    [conversation.id]: {
      ...conversation,
      messagelist: conversation.messagelist.length
        ? conversation.messagelist
        : existing?.messagelist ?? [],
    },
  }
}

function appendMessageToConversation(
  conversation: Conversation,
  message: ChatMessage,
) {
  return {
    ...conversation,
    messagelist: [...conversation.messagelist, message],
    timeStamp: Date.now(),
  }
}

function appendAssistantContent(
  conversation: Conversation,
  id: string,
  content: string,
) {
  return {
    ...conversation,
    messagelist: conversation.messagelist.map((message) =>
      message.id === id
        ? { ...message, content: message.content + content }
        : message,
    ),
    timeStamp: Date.now(),
  }
}

export function chatReducer(
  state: ChatState,
  action: ChatAction,
): ChatState {
  switch (action.type) {
    case 'setInitialized':
      return { ...state, initialized: action.initialized }
    case 'setError':
      return { ...state, error: action.error }
    case 'setConversations':
      return {
        ...state,
        conversations: toConversationRecord(action.conversations),
        currentId: action.currentId,
      }
    case 'setCurrentId':
      return { ...state, currentId: action.id }
    case 'setConversationMessages':
      return {
        ...state,
        conversations: upsertConversation(
          state.conversations,
          action.conversation,
        ),
        currentId: action.conversation.id,
      }
    case 'upsertConversation':
      return {
        ...state,
        conversations: upsertConversation(
          state.conversations,
          action.conversation,
        ),
      }
    case 'appendMessage':
      return reduceAppendMessage(state, action)
    case 'appendAssistantContent':
      return reduceAppendAssistantContent(state, action)
    default:
      return state
  }
}

function reduceAppendMessage(
  state: ChatState,
  action: Extract<ChatAction, { type: 'appendMessage' }>,
) {
  const conversation = state.conversations[action.conversationId]
  if (!conversation) return state

  return {
    ...state,
    conversations: {
      ...state.conversations,
      [action.conversationId]: appendMessageToConversation(
        conversation,
        action.message,
      ),
    },
  }
}

function reduceAppendAssistantContent(
  state: ChatState,
  action: Extract<ChatAction, { type: 'appendAssistantContent' }>,
) {
  const conversation = state.conversations[action.conversationId]
  if (!conversation) return state

  return {
    ...state,
    conversations: {
      ...state.conversations,
      [action.conversationId]: appendAssistantContent(
        conversation,
        action.id,
        action.content,
      ),
    },
  }
}
