import { SendHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import { ChatSidebar } from './components/ChatSidebar'
import { VoiceButton } from './components/VoiceButton'
import { MessageList } from './components/MessageList'
import { ChatProvider } from './store/chatStore'
import { useChatStore } from './store/useChatStore'
import { useWebSocketChat } from './hooks/useWebSocketChat'
import styles from './App.module.less'

function ChatPage() {
  const {
    currentConversation,
    recentMessages,
    inputMessage,
    setInputMessage,
    addUserMessage,
    addAssistantMessage,
    updateAssistantMessage,
    renameConversationFromFirstMessage,
    formatMessagesForLLM,
  } = useChatStore()

  const { loading, sendMessage } = useWebSocketChat({
    getHistory: formatMessagesForLLM,
    addUserMessage,
    addAssistantMessage,
    updateAssistantMessage,
    renameConversationFromFirstMessage,
  })

  const chatStats = useMemo(
    () => ({
      totalMessages: recentMessages.length,
      userMessages: recentMessages.filter((message) => message.role === 'user')
        .length,
    }),
    [recentMessages],
  )
  async function handleSend() {
    const sent = await sendMessage(inputMessage)
    if (sent) setInputMessage('')
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    void handleSend()
  }

  return (
    <div className={styles.mainContainer}>
      <ChatSidebar />

      <main className={styles.chatContainer}>
        <header className={styles.chatShell}>
          <div>
            <p className={styles.overline}>AI Assistant</p>
            <h1>{currentConversation.tittle}</h1>
            <p className={styles.subline}>
              流式聊天和 Markdown 渲染已经迁移到 React，语音输入会先转写到输入框。
            </p>
          </div>

          <div className={styles.statsPanel} aria-label="当前对话统计">
            <div>
              <strong>{chatStats.totalMessages}</strong>
              <span>消息总数</span>
            </div>
            <div>
              <strong>{chatStats.userMessages}</strong>
              <span>你的提问</span>
            </div>
          </div>
        </header>

        <MessageList
          conversationId={currentConversation.id}
          messages={recentMessages}
        />

        <section className={styles.composer}>
          <div className={styles.composerHead}>
            <span>Message</span>
            <span>{loading ? '正在生成回复...' : 'Enter 发送，Shift + Enter 换行'}</span>
          </div>

          <div className={styles.composerBody}>
            <textarea
              aria-label="请输入你要发送的文本"
              placeholder="请输入你要发送的文本"
              value={inputMessage}
              onChange={(event) => setInputMessage(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
            />

            <div className={styles.composerActions}>
              <VoiceButton disabled={loading} onTranscript={setInputMessage} />
              <button
                className={styles.sendButton}
                type="button"
                disabled={loading || !inputMessage.trim()}
                onClick={() => void handleSend()}
              >
                <SendHorizontal aria-hidden="true" size={18} />
                {loading ? '发送中' : '发送消息'}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function App() {
  return (
    <ChatProvider>
      <ChatPage />
    </ChatProvider>
  )
}

export default App
