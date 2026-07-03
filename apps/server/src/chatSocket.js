import { parseClientMessage, sendJson } from './socketProtocol.js'

const STREAM_PERSIST_INTERVAL_MS = 1000

function sendError(ws, requestId, message) {
  sendJson(ws, {
    type: 'chat:error',
    requestId,
    message,
  })
}

function validateChatStartPayload(payload) {
  const message = typeof payload.message === 'string' ? payload.message.trim() : ''
  const conversationId =
    typeof payload.conversationId === 'string' ? payload.conversationId : ''

  if (!conversationId) throw new Error('缺少 conversationId')
  if (!message) throw new Error('请输入问题')

  return { conversationId, message }
}

async function persistAssistantContent(chatRepository, assistantMessageId, content) {
  if (!assistantMessageId) return

  await chatRepository.updateAssistantMessage({
    content,
    id: assistantMessageId,
    status: 'streaming',
  })
}

async function finishAssistantMessage(options) {
  if (!options.assistantMessageId) return

  await options.chatRepository.updateAssistantMessage({
    content: options.content,
    errorMessage: options.errorMessage,
    id: options.assistantMessageId,
    status: options.status,
  })
}

function sendAccepted(ws, requestId, turn) {
  sendJson(ws, {
    type: 'chat:accepted',
    requestId,
    assistantMessage: turn.assistantMessage,
    conversation: turn.conversation,
    userMessage: turn.userMessage,
  })
}

async function streamAssistantResponse(ws, options) {
  let content = ''
  let lastPersistedAt = 0

  for await (const event of options.chatClient.streamChat({
    history: options.history,
    message: options.message,
    signal: options.signal,
  })) {
    if (event.type === 'delta') {
      content += event.content
      sendJson(ws, {
        type: 'chat:delta',
        requestId: options.requestId,
        content: event.content,
      })
      lastPersistedAt = await persistStreamContent(options, {
        content,
        lastPersistedAt,
      })
    }

    if (event.type === 'done') return content
  }

  return content
}

async function persistStreamContent(options, state) {
  const now = Date.now()
  if (now - state.lastPersistedAt < STREAM_PERSIST_INTERVAL_MS) {
    return state.lastPersistedAt
  }

  await persistAssistantContent(
    options.chatRepository,
    options.assistantMessageId,
    state.content,
  )
  return now
}

async function handleChatFailure(ws, options) {
  const message = options.error instanceof Error ? options.error.message : '未知错误'
  const status = options.signal.aborted ? 'cancelled' : 'failed'

  await finishAssistantMessage({
    assistantMessageId: options.assistantMessageId,
    chatRepository: options.chatRepository,
    content: options.assistantContent,
    errorMessage: status === 'failed' ? message : undefined,
    status,
  })

  if (status === 'cancelled') {
    sendJson(ws, { type: 'chat:cancelled', requestId: options.requestId })
    return
  }

  sendError(ws, options.requestId, message)
}

async function handleChatStart(ws, payload, services, session, abortController) {
  const { requestId } = payload
  let assistantMessageId = null
  let assistantContent = ''

  try {
    const { conversationId, message } = validateChatStartPayload(payload)
    const turn = await services.chatRepository.startAssistantTurn({
      content: message,
      conversationId,
      requestId,
      userId: session.user.id,
    })
    assistantMessageId = turn.assistantMessage.id

    sendAccepted(ws, requestId, turn)

    if (abortController.signal.aborted) {
      throw new Error('请求已取消')
    }

    assistantContent = await streamAssistantResponse(ws, {
      assistantMessageId,
      chatClient: services.chatClient,
      chatRepository: services.chatRepository,
      history: turn.history,
      message,
      requestId,
      signal: abortController.signal,
    })

    await finishAssistantMessage({
      assistantMessageId,
      chatRepository: services.chatRepository,
      content: assistantContent,
      status: 'completed',
    })
    sendJson(ws, { type: 'chat:done', requestId })
  } catch (error) {
    await handleChatFailure(ws, {
      assistantContent,
      assistantMessageId,
      chatRepository: services.chatRepository,
      error,
      requestId,
      signal: abortController.signal,
    })
  }
}

export function bindChatSocket(wss, services) {
  wss.on('connection', (ws, request) => {
    let activeRequest = null
    let sessionPromise = null

    function getSession() {
      sessionPromise ??= services.sessionService.getSession(request)
      return sessionPromise
    }

    ws.on('message', (data, isBinary) => {
      const payload = parseClientMessage(isBinary ? null : data.toString())
      if (!payload) {
        sendError(ws, undefined, '无法解析客户端消息')
        return
      }

      if (payload.type === 'chat:cancel') {
        activeRequest?.abort()
        activeRequest = null
        return
      }

      if (payload.type !== 'chat:start') {
        sendError(ws, payload.requestId, `不支持的消息类型：${payload.type}`)
        return
      }

      activeRequest?.abort()
      const requestController = new AbortController()
      activeRequest = requestController

      void getSession()
        .then((session) => {
          if (!session) {
            sendError(ws, payload.requestId, '请先初始化会话')
            return
          }

          return handleChatStart(ws, payload, services, session, requestController)
        })
        .catch((error) => {
          sendError(
            ws,
            payload.requestId,
            error instanceof Error ? error.message : '未知错误',
          )
        })
        .finally(() => {
          if (activeRequest === requestController) {
            activeRequest = null
          }
        })
    })

    ws.on('close', () => {
      activeRequest?.abort()
      activeRequest = null
    })
  })
}
