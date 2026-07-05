export function createRagEmbeddings({ model, provider }) {
  if (!provider) {
    throw new Error('缺少 RAG_EMBEDDING_PROVIDER 配置')
  }

  const modelMessage = model ? `，模型：${model}` : ''
  throw new Error(`不支持的 RAG_EMBEDDING_PROVIDER：${provider}${modelMessage}`)
}
