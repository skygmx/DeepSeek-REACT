import type { RefObject } from 'react'
import type { ChatMessage } from '../types/chat'
import { MessageItem } from './MessageItem'
import styles from '../App.module.less'

interface MessageListProps {
  messages: ChatMessage[]
  historyRef: RefObject<HTMLDivElement | null>
}

export function MessageList({ messages, historyRef }: MessageListProps) {
  return (
    <section className={styles.chatHistory} ref={historyRef}>
      {!messages.length && (
        <div className={styles.emptyState}>
          <div>
            <p className={styles.emptyTitle}>开始一段新的对话</p>
            <p className={styles.emptyCopy}>
              问一个具体问题，让这条 React 会话链路先跑起来。
            </p>
          </div>
        </div>
      )}

      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </section>
  )
}
