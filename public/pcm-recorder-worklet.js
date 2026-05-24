const DEFAULT_TARGET_SAMPLE_RATE = 16000
const DEFAULT_CHUNK_MS = 200

// 运行在音频渲染线程，只做采样处理，不直接访问 DOM 或 WebSocket。
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const processorOptions = options.processorOptions ?? {}

    this.targetSampleRate =
      processorOptions.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE
    this.frameSamples = Math.max(
      1,
      Math.round(
        this.targetSampleRate *
          ((processorOptions.chunkMs ?? DEFAULT_CHUNK_MS) / 1000),
      ),
    )
    this.sampleRatio = sampleRate / this.targetSampleRate
    this.inputBuffer = []
    this.readIndex = 0
    this.outputBuffer = []

    this.port.onmessage = (event) => {
      if (event.data?.type !== 'flush') return

      this.drainResampledInput()
      this.postChunk(true)
      this.port.postMessage({ type: 'flushed' })
    }
  }

  appendInput(input) {
    for (let index = 0; index < input.length; index += 1) {
      this.inputBuffer.push(input[index])
    }
  }

  compactInputBuffer() {
    const consumed = Math.floor(this.readIndex)
    if (consumed < 128) return

    this.inputBuffer = this.inputBuffer.slice(consumed)
    this.readIndex -= consumed
  }

  drainResampledInput() {
    // 浏览器输入采样率可能是 48kHz，这里线性插值降到豆包要求的 16kHz。
    while (this.readIndex + this.sampleRatio < this.inputBuffer.length) {
      const leftIndex = Math.floor(this.readIndex)
      const rightIndex = Math.min(leftIndex + 1, this.inputBuffer.length - 1)
      const fraction = this.readIndex - leftIndex
      const sample =
        this.inputBuffer[leftIndex] +
        (this.inputBuffer[rightIndex] - this.inputBuffer[leftIndex]) * fraction

      this.outputBuffer.push(Math.max(-1, Math.min(1, sample)))
      this.readIndex += this.sampleRatio
    }

    this.compactInputBuffer()
  }

  postChunk(force = false) {
    // 豆包建议 100-200ms 一包；这里按 200ms 切成 pcm_s16le 发送给主线程。
    while (
      this.outputBuffer.length >= this.frameSamples ||
      (force && this.outputBuffer.length > 0)
    ) {
      const chunkSize = force
        ? Math.min(this.outputBuffer.length, this.frameSamples)
        : this.frameSamples
      const pcm = new Int16Array(chunkSize)

      for (let index = 0; index < chunkSize; index += 1) {
        const sample = this.outputBuffer.shift()
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      }

      this.port.postMessage({ type: 'chunk', buffer: pcm.buffer }, [
        pcm.buffer,
      ])
    }
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input?.length) return true

    this.appendInput(input)
    this.drainResampledInput()
    this.postChunk()

    return true
  }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor)
