import { parseClientMessage, sendJson } from './socketProtocol.js'

const DEFAULT_AUDIO_CONFIG = {
  format: 'pcm',
  codec: 'raw',
  rate: 16000,
  bits: 16,
  channel: 1,
}

function sendError(ws, requestId, message) {
  sendJson(ws, {
    type: 'asr:error',
    requestId,
    message,
  })
}

function closeSession(session) {
  try {
    session?.close()
  } catch {
    // The upstream socket may already be closed by the ASR provider.
  }
}

export function bindAsrSocket(wss, { asrClient }) {
  wss.on('connection', (ws) => {
    let activeRequestId = null
    let activeSession = null
    let starting = false
    let ended = false

    function endSession() {
      if (ended) return
      ended = true
      sendJson(ws, { type: 'asr:ended', requestId: activeRequestId })
      activeRequestId = null
      activeSession = null
      starting = false
    }

    async function handleStart(payload) {
      closeSession(activeSession)
      activeSession = null
      activeRequestId = payload.requestId
      starting = true
      ended = false

      try {
        activeSession = await asrClient.startSession({
          requestId: payload.requestId,
          audio: {
            ...DEFAULT_AUDIO_CONFIG,
            ...payload.audio,
          },
          onResult(result) {
            sendJson(ws, {
              type: result.isFinal ? 'asr:final' : 'asr:partial',
              requestId: payload.requestId,
              text: result.text,
            })
          },
          onError(error) {
            sendError(
              ws,
              payload.requestId,
              error instanceof Error ? error.message : '语音识别失败',
            )
            endSession()
          },
          onEnd() {
            endSession()
          },
        })
        starting = false
        sendJson(ws, { type: 'asr:ready', requestId: payload.requestId })
      } catch (error) {
        sendError(
          ws,
          payload.requestId,
          error instanceof Error ? error.message : '语音识别启动失败',
        )
        endSession()
      }
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!activeSession) {
          sendError(ws, activeRequestId, '语音识别连接尚未就绪')
          return
        }

        try {
          activeSession.sendAudio(Buffer.from(data))
        } catch (error) {
          sendError(
            ws,
            activeRequestId,
            error instanceof Error ? error.message : '语音数据发送失败',
          )
        }
        return
      }

      const payload = parseClientMessage(data.toString())
      if (!payload) {
        sendError(ws, undefined, '无法解析客户端消息')
        return
      }

      if (payload.type === 'asr:start') {
        if (!payload.requestId) {
          sendError(ws, undefined, '缺少 requestId')
          return
        }

        void handleStart(payload)
        return
      }

      if (payload.type === 'asr:end') {
        if (!activeSession) {
          if (starting) return
          sendError(ws, payload.requestId, '没有正在进行的语音识别')
          return
        }

        try {
          activeSession.finish()
        } catch (error) {
          sendError(
            ws,
            payload.requestId,
            error instanceof Error ? error.message : '语音识别结束失败',
          )
          endSession()
        }
        return
      }

      if (payload.type === 'asr:cancel') {
        closeSession(activeSession)
        endSession()
        return
      }

      sendError(ws, payload.requestId, `不支持的消息类型：${payload.type}`)
    })

    ws.on('close', () => {
      closeSession(activeSession)
      activeSession = null
    })
  })
}
