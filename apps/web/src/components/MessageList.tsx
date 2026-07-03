import { forwardRef, useEffect, useRef } from 'react'
import { Virtuoso, type Components, type VirtuosoHandle } from 'react-virtuoso'
import type { ChatMessage } from '../types/chat'
import { MessageItem } from './MessageItem'
import styles from '../App.module.less'

interface MessageListProps {
  conversationId: string
  messages: ChatMessage[]
}

const VirtualMessageList = forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  function VirtualMessageList({ children, className, ...props }, ref) {
    return (
      <div
        {...props}
        className={[styles.virtualMessageList, className]
          .filter(Boolean)
          .join(' ')}
        ref={ref}
      >
        {children}
      </div>
    )
  },
)

const virtuosoComponents: Components<ChatMessage> = {
  List: VirtualMessageList,
  Item: ({ children, ...props }) => <div {...props}>{children}</div>,
}

export function MessageList({ conversationId, messages }: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const isAtBottomRef = useRef(true)
  const latestMessageContent = messages.at(-1)?.content

  useEffect(() => {
    if (!messages.length || !isAtBottomRef.current) return

    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      align: 'end',
      behavior: 'auto',
    })
  }, [messages.length, latestMessageContent])

  return (
    <section className={styles.chatHistory}>
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

      {!!messages.length && (
        <Virtuoso
          alignToBottom
          atBottomStateChange={(atBottom) => {
            isAtBottomRef.current = atBottom
          }}
          atBottomThreshold={80}
          className={styles.virtualMessageScroller}
          components={virtuosoComponents}
          computeItemKey={(_, message) => message.id}
          data={messages}
          followOutput="auto"
          increaseViewportBy={{ bottom: 600, top: 300 }}
          initialTopMostItemIndex={{
            index: messages.length - 1,
            align: 'end',
          }}
          itemContent={(_, message) => <MessageItem message={message} />}
          key={conversationId}
          ref={virtuosoRef}
        />
      )}
    </section>
  )
}
