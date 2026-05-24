import type { Conversation, StoredConversationEntry } from '../types/chat'

const STORAGE_KEY = 'conversations_data'

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== 'object') return false

  const target = value as Partial<Conversation>
  return (
    typeof target.id === 'string' &&
    Array.isArray(target.messagelist) &&
    typeof target.timeStamp === 'number' &&
    typeof target.tittle === 'string'
  )
}

export function loadConversations() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return null

    const conversations = parsed.reduce<Record<string, Conversation>>(
      (result, entry) => {
        if (!Array.isArray(entry) || entry.length !== 2) return result

        const [id, value] = entry as StoredConversationEntry
        if (typeof id === 'string' && isConversation(value)) {
          result[id] = value
        }
        return result
      },
      {},
    )

    return Object.keys(conversations).length ? conversations : null
  } catch (error) {
    console.error('会话加载失败：', error)
    return null
  }
}

export function saveConversations(conversations: Record<string, Conversation>) {
  try {
    const entries: StoredConversationEntry[] = Object.entries(conversations)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.error('会话保存失败：', error)
  }
}

