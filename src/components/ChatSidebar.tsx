import { Plus } from 'lucide-react'
import { useChatStore } from '../store/useChatStore'
import styles from './ChatSidebar.module.less'

export function ChatSidebar() {
  const {
    currentConversation,
    conversationList,
    addConversation,
    switchConversation,
  } = useChatStore()

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <p className={styles.eyebrow}>Workspace</p>
        <h2>DeepSeek Chat</h2>
        <p className={styles.sidebarCopy}>在这里切换上下文，保留每一段对话痕迹。</p>
        <button
          className={styles.newChatButton}
          type="button"
          onClick={() => void addConversation()}
        >
          <Plus aria-hidden="true" size={18} />
          新建对话
        </button>
      </div>

      <div className={styles.conversationList}>
        {conversationList.map((conversation) => {
          const isActive = conversation.id === currentConversation?.id

          return (
            <button
              className={`${styles.sessionCard}${isActive ? ` ${styles.strong}` : ''}`}
              key={conversation.id}
              type="button"
              onClick={() => void switchConversation(conversation.id)}
            >
              <span className={styles.sessionTitle}>{conversation.tittle}</span>
              <span className={styles.sessionCount}>
                {conversation.messageCount || conversation.messagelist.length} 条消息
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
