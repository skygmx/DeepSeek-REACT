import { LoaderCircle, Mic, MicOff } from 'lucide-react'
import { useAsrSocket } from '../hooks/useAsrSocket'
import styles from './VoiceButton.module.less'

interface VoiceButtonProps {
  disabled?: boolean
  onTranscript: (text: string) => void
}

function getStatusText(status: string, errorMessage: string) {
  if (status === 'recording') return '录音中，主要支持中文识别'
  if (status === 'connecting') return '正在连接语音识别'
  if (status === 'stopping') return '正在整理识别结果'
  if (status === 'error') return errorMessage || '语音识别失败'
  return '主要支持中文识别'
}

export function VoiceButton({ disabled = false, onTranscript }: VoiceButtonProps) {
  const { errorMessage, isRecording, start, status, stop } = useAsrSocket({
    onText: onTranscript,
  })
  const isBusy = status === 'connecting' || status === 'stopping'
  const buttonDisabled = disabled || isBusy

  function handleClick() {
    if (isRecording) {
      void stop()
      return
    }

    void start()
  }

  return (
    <div className={styles.voiceControl}>
      <button
        aria-label={isRecording ? '停止语音输入' : '语音输入'}
        className={`${styles.voiceButton} ${isRecording ? styles.recording : ''}`}
        title={isRecording ? '停止语音输入' : '语音输入'}
        type="button"
        disabled={buttonDisabled}
        onClick={handleClick}
      >
        {isBusy ? (
          <LoaderCircle aria-hidden="true" size={22} />
        ) : isRecording ? (
          <MicOff aria-hidden="true" size={22} />
        ) : (
          <Mic aria-hidden="true" size={22} />
        )}
      </button>
      <span className={styles.voiceHint}>
        {getStatusText(status, errorMessage)}
      </span>
    </div>
  )
}
