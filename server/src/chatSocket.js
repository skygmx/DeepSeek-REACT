import { parseClientMessage, sendJson } from './socketProtocol.js'

function sendError(ws, requestId, message) {
  sendJson(ws, {
    type: 'chat:error',
    requestId,
    message,
  })
}

async function handleChatStart(ws, payload, chatClient, abortController) {
  const { requestId } = payload

  try {
    for await (const event of chatClient.streamChat({
      message: payload.message,
      history: payload.history,
      signal: abortController.signal,
    })) {
      if (event.type === 'delta') {
        sendJson(ws, {
          type: 'chat:delta',
          requestId,
          content: event.content,
        })
      }

      if (event.type === 'done') {
        sendJson(ws, { type: 'chat:done', requestId })
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      sendJson(ws, { type: 'chat:cancelled', requestId })
      return
    }

    sendError(
      ws,
      requestId,
      error instanceof Error ? error.message : '未知错误',
    )
  }
}

export function bindChatSocket(wss, { chatClient }) {
  wss.on('connection', (ws) => {
    let activeRequest = null

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
      activeRequest = new AbortController()
      sendJson(ws, { type: 'chat:accepted', requestId: payload.requestId })

      void handleChatStart(ws, payload, chatClient, activeRequest).finally(() => {
        activeRequest = null
      })
    })

    ws.on('close', () => {
      activeRequest?.abort()
      activeRequest = null
    })
  })
}

