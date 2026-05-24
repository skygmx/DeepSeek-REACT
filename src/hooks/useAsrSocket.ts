import { useCallback, useEffect, useRef, useState } from 'react'
import { PcmRecorder } from '../audio/pcmRecorder'
import { createId } from '../utils/ids'

type AsrStatus = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error'

type AsrServerMessage =
  | { type: 'asr:ready'; requestId: string }
  | { type: 'asr:partial'; requestId: string; text: string }
  | { type: 'asr:final'; requestId: string; text: string }
  | { type: 'asr:ended'; requestId?: string }
  | { type: 'asr:error'; requestId?: string; message: string }

interface UseAsrSocketOptions {
  onText: (text: string) => void
}

const ASR_WS_ENDPOINT =
  import.meta.env.VITE_ASR_WS_URL ?? `ws://${window.location.hostname}:3000/ws/asr`

function parseServerMessage(data: MessageEvent['data']) {
  if (typeof data !== 'string') return null

  try {
    return JSON.parse(data) as AsrServerMessage
  } catch {
    return null
  }
}

export function useAsrSocket({ onText }: UseAsrSocketOptions) {
  const [status, setStatus] = useState<AsrStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<PcmRecorder | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const closedByClientRef = useRef(false)

  const updateStatus = useCallback((nextStatus: AsrStatus) => {
    setStatus(nextStatus)
  }, [])

  const closeRecorder = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    await recorder?.stop()
  }, [])

  const closeSocket = useCallback(() => {
    closedByClientRef.current = true
    socketRef.current?.close()
    socketRef.current = null
    requestIdRef.current = null
  }, [])

  const cleanupSession = useCallback(async () => {
    await closeRecorder()
    closeSocket()
  }, [closeRecorder, closeSocket])

  const resetSession = useCallback(async () => {
    await cleanupSession()
    updateStatus('idle')
  }, [cleanupSession, updateStatus])

  const sendJson = useCallback((payload: unknown) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
    }
  }, [])

  const handleError = useCallback(
    async (message: string) => {
      setErrorMessage(message)
      updateStatus('error')
      await closeRecorder()
      closeSocket()
    },
    [closeRecorder, closeSocket, updateStatus],
  )

  const startRecorder = useCallback(async () => {
    const recorder = new PcmRecorder({
      onChunk(chunk) {
        const socket = socketRef.current
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(chunk)
        }
      },
    })

    recorderRef.current = recorder
    await recorder.start()
    updateStatus('recording')
  }, [updateStatus])

  const start = useCallback(async () => {
    if (status === 'recording' || status === 'connecting') return

    const requestId = createId('asr')
    const socket = new WebSocket(ASR_WS_ENDPOINT)
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    requestIdRef.current = requestId
    closedByClientRef.current = false
    setErrorMessage('')
    updateStatus('connecting')

    socket.addEventListener('open', () => {
      sendJson({
        type: 'asr:start',
        requestId,
        audio: {
          bits: 16,
          channel: 1,
          codec: 'raw',
          format: 'pcm',
          rate: 16000,
        },
      })
    })

    socket.addEventListener('message', (event) => {
      const payload = parseServerMessage(event.data)
      if (!payload) return
      if (payload.requestId && payload.requestId !== requestId) return

      if (payload.type === 'asr:ready') {
        void startRecorder().catch((error: unknown) => {
          sendJson({ type: 'asr:cancel', requestId })
          void handleError(
            error instanceof Error ? error.message : '麦克风启动失败',
          )
        })
        return
      }

      if (payload.type === 'asr:partial' || payload.type === 'asr:final') {
        onText(payload.text)
        return
      }

      if (payload.type === 'asr:ended') {
        void resetSession()
        return
      }

      if (payload.type === 'asr:error') {
        void handleError(payload.message)
      }
    })

    socket.addEventListener('error', () => {
      void handleError('语音识别连接异常')
    })

    socket.addEventListener('close', () => {
      if (closedByClientRef.current) return
      void handleError('语音识别连接已关闭')
    })
  }, [
    handleError,
    onText,
    resetSession,
    sendJson,
    startRecorder,
    status,
    updateStatus,
  ])

  const stop = useCallback(async () => {
    const requestId = requestIdRef.current
    if (!requestId) return

    updateStatus('stopping')
    await closeRecorder()
    sendJson({ type: 'asr:end', requestId })
  }, [closeRecorder, sendJson, updateStatus])

  const cancel = useCallback(async () => {
    const requestId = requestIdRef.current
    if (requestId) {
      sendJson({ type: 'asr:cancel', requestId })
    }
    await resetSession()
  }, [resetSession, sendJson])

  useEffect(() => {
    return () => {
      void cleanupSession()
    }
  }, [cleanupSession])

  return {
    cancel,
    errorMessage,
    isRecording: status === 'recording',
    start,
    status,
    stop,
  }
}
