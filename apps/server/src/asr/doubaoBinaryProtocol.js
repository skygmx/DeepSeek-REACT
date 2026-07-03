import { gunzipSync, gzipSync } from 'node:zlib'

const PROTOCOL_VERSION = 0x1
const HEADER_SIZE_WORDS = 0x1

const MESSAGE_TYPES = {
  fullClientRequest: 0x1,
  audioOnlyRequest: 0x2,
  fullServerResponse: 0x9,
  errorResponse: 0xf,
}

const MESSAGE_FLAGS = {
  noSequence: 0x0,
  positiveSequence: 0x1,
  lastPacketNoSequence: 0x2,
  lastPacketNegativeSequence: 0x3,
}

const SERIALIZATION = {
  none: 0x0,
  json: 0x1,
}

const COMPRESSION = {
  none: 0x0,
  gzip: 0x1,
}

function createHeader({ messageType, flags, serialization, compression }) {
  // 豆包二进制协议的 header 固定 4 字节，每个高低 4 bit 表示不同含义。
  return Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE_WORDS,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ])
}

function packPayload(header, payload) {
  const size = Buffer.alloc(4)
  // 协议要求长度字段使用大端，音频内容本身仍保持 PCM 小端。
  size.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, size, payload])
}

export function createFullClientRequest(payload) {
  // 首包只发送识别配置，不带音频数据。
  const header = createHeader({
    messageType: MESSAGE_TYPES.fullClientRequest,
    flags: MESSAGE_FLAGS.noSequence,
    serialization: SERIALIZATION.json,
    compression: COMPRESSION.gzip,
  })
  const body = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))

  return packPayload(header, body)
}

export function createAudioOnlyRequest(audioChunk, { isFinal = false } = {}) {
  // 最后一包通过 flags 标记为负包，豆包据此结束本轮识别。
  const header = createHeader({
    messageType: MESSAGE_TYPES.audioOnlyRequest,
    flags: isFinal
      ? MESSAGE_FLAGS.lastPacketNoSequence
      : MESSAGE_FLAGS.noSequence,
    serialization: SERIALIZATION.none,
    compression: COMPRESSION.gzip,
  })
  const body = gzipSync(audioChunk)

  return packPayload(header, body)
}

function decodePayload(buffer, { compression, serialization }) {
  const uncompressed =
    compression === COMPRESSION.gzip ? gunzipSync(buffer) : buffer

  if (serialization !== SERIALIZATION.json) {
    return uncompressed
  }

  const text = uncompressed.toString('utf8')
  return text ? JSON.parse(text) : null
}

function parseErrorResponse(buffer, offset) {
  const code = buffer.readUInt32BE(offset)
  const size = buffer.readUInt32BE(offset + 4)
  const messageBuffer = buffer.subarray(offset + 8, offset + 8 + size)
  const messageText = messageBuffer.toString('utf8')

  try {
    return {
      type: 'error',
      code,
      payload: JSON.parse(messageText),
      message: messageText,
    }
  } catch {
    return { type: 'error', code, payload: null, message: messageText }
  }
}

export function parseServerResponse(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const headerSize = (buffer[0] & 0x0f) * 4
  const messageType = (buffer[1] >> 4) & 0x0f
  const flags = buffer[1] & 0x0f
  const serialization = (buffer[2] >> 4) & 0x0f
  const compression = buffer[2] & 0x0f
  let offset = headerSize

  if (messageType === MESSAGE_TYPES.errorResponse) {
    return parseErrorResponse(buffer, offset)
  }

  if (messageType !== MESSAGE_TYPES.fullServerResponse) {
    return {
      type: 'unknown',
      messageType,
      payload: null,
      isFinal: false,
    }
  }

  let sequence = null
  // 服务端响应可能携带 sequence，解析时兼容即可；客户端请求不主动依赖它。
  if (
    flags === MESSAGE_FLAGS.positiveSequence ||
    flags === MESSAGE_FLAGS.lastPacketNegativeSequence
  ) {
    sequence = buffer.readInt32BE(offset)
    offset += 4
  }

  const payloadSize = buffer.readUInt32BE(offset)
  offset += 4

  const payload = decodePayload(buffer.subarray(offset, offset + payloadSize), {
    compression,
    serialization,
  })

  return {
    type: 'response',
    sequence,
    payload,
    isFinal:
      flags === MESSAGE_FLAGS.lastPacketNoSequence ||
      flags === MESSAGE_FLAGS.lastPacketNegativeSequence,
  }
}
