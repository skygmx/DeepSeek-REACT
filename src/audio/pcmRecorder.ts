const DEFAULT_TARGET_SAMPLE_RATE = 16000
const DEFAULT_CHUNK_MS = 200

interface PcmRecorderOptions {
  chunkMs?: number
  onChunk: (chunk: ArrayBuffer) => void
  targetSampleRate?: number
}

export class PcmRecorder {
  private readonly chunkMs: number
  private readonly onChunk: (chunk: ArrayBuffer) => void
  private readonly targetSampleRate: number
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private silentGain: GainNode | null = null
  private flushResolver: (() => void) | null = null

  constructor({
    chunkMs = DEFAULT_CHUNK_MS,
    onChunk,
    targetSampleRate = DEFAULT_TARGET_SAMPLE_RATE,
  }: PcmRecorderOptions) {
    this.chunkMs = chunkMs
    this.onChunk = onChunk
    this.targetSampleRate = targetSampleRate
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风录音')
    }
    if (!window.AudioWorkletNode) {
      throw new Error('当前浏览器不支持 AudioWorklet')
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
    this.audioContext = new AudioContext()

    // AudioWorklet 只负责处理音频帧；麦克风授权和节点连接必须在主线程完成。
    await this.audioContext.audioWorklet.addModule('/pcm-recorder-worklet.js')

    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      'pcm-recorder',
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          chunkMs: this.chunkMs,
          targetSampleRate: this.targetSampleRate,
        },
      },
    )
    this.workletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'chunk' && event.data.buffer instanceof ArrayBuffer) {
        this.onChunk(event.data.buffer)
        return
      }

      if (event.data?.type === 'flushed') {
        this.flushResolver?.()
        this.flushResolver = null
      }
    }

    this.silentGain = this.audioContext.createGain()
    this.silentGain.gain.value = 0
    // 接到静音输出是为了让浏览器持续调度 worklet，同时避免把麦克风声音外放。
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
    this.sourceNode.connect(this.workletNode)
    this.workletNode.connect(this.silentGain)
    this.silentGain.connect(this.audioContext.destination)
  }

  async stop() {
    const workletNode = this.workletNode
    if (workletNode) {
      // 停止前先 flush，避免最后不足 200ms 的语音丢失。
      await new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(resolve, 150)
        this.flushResolver = () => {
          window.clearTimeout(timeoutId)
          resolve()
        }
        workletNode.port.postMessage({ type: 'flush' })
      })
    }

    this.sourceNode?.disconnect()
    this.workletNode?.disconnect()
    this.silentGain?.disconnect()
    this.mediaStream?.getTracks().forEach((track) => track.stop())
    await this.audioContext?.close()

    this.audioContext = null
    this.mediaStream = null
    this.sourceNode = null
    this.workletNode = null
    this.silentGain = null
    this.flushResolver = null
  }
}
