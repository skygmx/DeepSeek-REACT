import { Mic } from 'lucide-react'
import styles from './VoiceButton.module.less'

export function VoiceButton() {
  return (
    <button
      aria-label="语音输入"
      className={styles.voiceButton}
      title="语音输入会在第三轮接入后端音频处理"
      type="button"
      disabled
    >
      <Mic aria-hidden="true" size={22} />
    </button>
  )
}
