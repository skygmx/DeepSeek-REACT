import { createParser } from 'eventsource-parser'

function validateMessage(message) {
  const trimmedMessage = typeof message === 'string' ? message.trim() : ''
  if (!trimmedMessage) throw new Error('请输入问题')
  return trimmedMessage
}

function getDeltaContent(data) {
  try {
    const parsed = JSON.parse(data)
    return parsed.choices?.[0]?.delta?.content ?? ''
  } catch {
    return data
  }
}

async function* parseDeepSeekStream(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  const queue = []
  let finished = false

  const parser = createParser({
    onEvent(event) {
      if (event.data === '[DONE]') {
        finished = true
        return
      }

      const content = getDeltaContent(event.data)
      if (content) {
        queue.push({ type: 'delta', content })
      }
    },
  })

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break

    parser.feed(decoder.decode(value, { stream: true }))
    while (queue.length) {
      yield queue.shift()
    }
  }

  while (queue.length) {
    yield queue.shift()
  }

  yield { type: 'done' }
}

export function createDeepSeekClient({ apiKey, apiUrl }) {
  return {
    async *streamChat({ message, history = [], signal }) {
      if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY 环境变量')

      const trimmedMessage = validateMessage(message)
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [...history, { role: 'user', content: trimmedMessage }],
          stream: true,
          temperature: 0.7,
        }),
        signal,
      })

      if (!response.ok) {
        throw new Error(`DeepSeek 请求失败：${response.status}`)
      }
      if (!response.body) {
        throw new Error('DeepSeek 未返回流式响应')
      }

      yield* parseDeepSeekStream(response.body)
    },
  }
}

