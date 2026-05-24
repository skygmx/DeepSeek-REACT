import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  createAudioOnlyRequest,
  createFullClientRequest,
  parseServerResponse,
} from './doubaoBinaryProtocol.js'

const DEFAULT_AUDIO_CONFIG = {
  format: 'pcm',
  codec: 'raw',
  rate: 16000,
  bits: 16,
  channel: 1,
}

function createAsrRequestPayload({ requestId, audio }) {
  return {
    user: {
      uid: requestId,
    },
    audio: {
      ...DEFAULT_AUDIO_CONFIG,
      ...audio,
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      // 返回全量文本，前端每次直接覆盖输入框，避免 partial 拼接错位。
      result_type: 'full',
    },
  }
}

function getResponseText(payload) {
  const result = Array.isArray(payload?.result)
    ? payload.result.at(-1)
    : payload?.result

  return typeof result?.text === 'string' ? result.text : ''
}

function createUpstreamHeaders({ accessKey, appKey, connectId, resourceId }) {
  // 当前账号走旧控制台鉴权：App Key + Access Key + Resource Id。
  return {
    'X-Api-App-Key': appKey,
    'X-Api-Access-Key': accessKey,
    'X-Api-Resource-Id': resourceId,
    'X-Api-Connect-Id': connectId,
  }
}

function createSessionState(upstream) {
  // 保留一包待发送，这样 stop 时可以把真正最后一包标记为结束包。
  let pendingAudio = null
  let sentAudio = false
  let finished = false

  function sendFrame(audioChunk, isFinal) {
    if (upstream.readyState !== WebSocket.OPEN) {
      throw new Error('豆包语音识别连接尚未就绪')
    }

    upstream.send(createAudioOnlyRequest(audioChunk, { isFinal }))
    sentAudio = sentAudio || audioChunk.length > 0
  }

  return {
    sendAudio(audioChunk) {
      if (finished) return

      if (pendingAudio) {
        sendFrame(pendingAudio, false)
      }
      pendingAudio = audioChunk
    },
    finish() {
      if (finished) return
      finished = true

      if (!sentAudio && !pendingAudio?.length) {
        throw new Error('没有收到可识别的音频数据')
      }

      sendFrame(pendingAudio ?? Buffer.alloc(0), true)
      pendingAudio = null
    },
  }
}

export function createDoubaoAsrClient({ accessKey, appKey, resourceId, wsUrl }) {
  return {
    startSession({ requestId, audio, onResult, onError, onEnd }) {
      if (!appKey) throw new Error('缺少 DOUBAO_ASR_APP_KEY 环境变量')
      if (!accessKey) throw new Error('缺少 DOUBAO_ASR_ACCESS_KEY 环境变量')
      if (!resourceId) throw new Error('缺少 DOUBAO_ASR_RESOURCE_ID 环境变量')

      return new Promise((resolve, reject) => {
        const connectId = randomUUID()
        const upstream = new WebSocket(wsUrl, {
          headers: createUpstreamHeaders({
            accessKey,
            appKey,
            connectId,
            resourceId,
          }),
        })
        const sessionState = createSessionState(upstream)
        let settled = false
        let closedByClient = false
        let receivedFinal = false
        let upstreamLogId = ''

        function settleSession() {
          if (settled) return
          settled = true
          resolve({
            sendAudio(audioChunk) {
              sessionState.sendAudio(audioChunk)
            },
            finish() {
              sessionState.finish()
            },
            close() {
              closedByClient = true
              upstream.close()
            },
          })
        }

        function fail(error) {
          if (!settled) {
            settled = true
            reject(error)
            return
          }

          onError(error)
        }

        upstream.on('open', () => {
          try {
            upstream.send(
              createFullClientRequest(
                createAsrRequestPayload({ requestId, audio }),
              ),
            )
            settleSession()
          } catch (error) {
            fail(error)
          }
        })

        upstream.on('upgrade', (response) => {
          upstreamLogId = response.headers['x-tt-logid'] ?? ''
        })

        upstream.on('message', (data) => {
          try {
            const parsed = parseServerResponse(data)
            if (parsed.type === 'error') {
              throw new Error(`豆包语音识别失败：${parsed.code} ${parsed.message}`)
            }
            if (parsed.type !== 'response') return

            const text = getResponseText(parsed.payload)
            if (text) {
              onResult({
                text,
                isFinal: parsed.isFinal,
                raw: parsed.payload,
              })
            }
            if (parsed.isFinal) {
              receivedFinal = true
              onEnd()
            }
          } catch (error) {
            fail(error)
          }
        })

        upstream.on('error', fail)
        upstream.on('close', (code, reasonBuffer) => {
          if (!settled || closedByClient) return
          if (!receivedFinal) {
            const reason = reasonBuffer.toString('utf8')
            // 豆包偶尔只给 1006 这类异常关闭，带上 logid 才方便后续排查。
            const detail = [
              `code=${code}`,
              reason ? `reason=${reason}` : '',
              upstreamLogId ? `logid=${upstreamLogId}` : '',
            ]
              .filter(Boolean)
              .join('，')
            onError(new Error(`豆包语音识别连接已关闭${detail ? `（${detail}）` : ''}`))
            return
          }
          onEnd()
        })
      })
    },
  }
}
