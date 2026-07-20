import { Embeddings } from '@langchain/core/embeddings'

const VOLCENGINE_PROVIDER = 'volcengine'
const MAX_CONCURRENCY = 5
const QUERY_INSTRUCTIONS =
  'Target_modality: text.\nInstruction:为这个句子生成表示以用于检索相关文章\nQuery:'
const CORPUS_INSTRUCTIONS =
  'Instruction:Compress the text into one word.\nQuery:'

function validateOptions(options) {
  if (!options.apiKey) throw new Error('缺少 RAG_EMBEDDING_API_KEY 配置')
  if (!options.model) throw new Error('缺少 RAG_EMBEDDING_MODEL 配置')
  if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
    throw new Error('RAG_EMBEDDING_DIMENSIONS 必须是正整数')
  }
}

async function readEmbedding(response, dimensions) {
  const payload = await response.json()
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`
    throw new Error(`火山方舟向量请求失败：${message}`)
  }

  const embedding = payload?.data?.embedding
  if (!Array.isArray(embedding) || embedding.length !== dimensions) {
    throw new Error(`火山方舟返回了无效的 ${dimensions} 维向量`)
  }
  return embedding
}

export class VolcengineRagEmbeddings extends Embeddings {
  constructor(options) {
    super({ maxConcurrency: MAX_CONCURRENCY, maxRetries: 2 })
    validateOptions(options)
    this.options = options
  }

  async requestEmbedding(text, instructions) {
    const response = await fetch(this.options.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        encoding_format: 'float',
        dimensions: this.options.dimensions,
        instructions,
        input: [{ type: 'text', text }],
      }),
    })
    return readEmbedding(response, this.options.dimensions)
  }

  async embedDocuments(documents) {
    return Promise.all(
      documents.map((text) =>
        this.caller.call(() => this.requestEmbedding(text, CORPUS_INSTRUCTIONS)),
      ),
    )
  }

  embedQuery(document) {
    return this.caller.call(() =>
      this.requestEmbedding(document, QUERY_INSTRUCTIONS),
    )
  }
}

export function createRagEmbeddings(options) {
  if (!options.provider) {
    throw new Error('缺少 RAG_EMBEDDING_PROVIDER 配置')
  }
  if (options.provider === VOLCENGINE_PROVIDER) {
    return new VolcengineRagEmbeddings(options)
  }

  throw new Error(`不支持的 RAG_EMBEDDING_PROVIDER：${options.provider}`)
}
