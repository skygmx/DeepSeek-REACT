import { memo, useMemo } from 'react'
import type { ChatMessage } from '../types/chat'
import { renderMarkdown } from '../utils/markdown'
import styles from '../App.module.less'

interface MessageItemProps {
  message: ChatMessage
}

function MessageItemComponent({ message }: MessageItemProps) {
  const isUser = message.role === 'user'
  const markdownContent = useMemo(() => {
    if (message.role !== 'assistant') return ''

    return renderMarkdown(message.content)
  }, [message.content, message.role])

  return (
    <article
      className={`${styles.messageItem} ${isUser ? styles.roleUser : styles.roleAssistant}`}
    >
      <div className={isUser ? styles.userMessage : styles.assistantMessage}>
        <span className={styles.roleLabel}>{isUser ? '你' : 'DeepSeek'}</span>
        {message.role === 'assistant' ? (
          <div
            className={`markdown-body ${styles.content}`}
            dangerouslySetInnerHTML={{
              __html: markdownContent,
            }}
          />
        ) : (
          <div className={styles.content}>{message.content}</div>
        )}
      </div>
    </article>
  )
}

export const MessageItem = memo(
  MessageItemComponent,
  (prev, next) => prev.message === next.message,
)
