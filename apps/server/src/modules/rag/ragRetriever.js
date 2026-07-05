function normalizeLimit(limit, fallback) {
  const parsedLimit = Number(limit)
  if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) return fallback
  return Math.min(parsedLimit, 20)
}

function createWorkspaceFilter({ documentId, session }) {
  const filter = {
    workspaceId: session.workspace.id,
  }

  if (documentId) filter.documentId = documentId
  return filter
}

function toMatch([document, score]) {
  return {
    content: document.pageContent,
    metadata: document.metadata,
    score,
  }
}

export function createRagRetriever({ config, getRagVectorStore }) {
  async function search({ documentId, limit, query, session }) {
    const trimmedQuery = typeof query === 'string' ? query.trim() : ''
    if (!trimmedQuery) throw new Error('缺少检索问题')

    const vectorStore = await getRagVectorStore()
    const matches = await vectorStore.similaritySearchWithScore(
      trimmedQuery,
      normalizeLimit(limit, config.retrieveLimit),
      createWorkspaceFilter({ documentId, session }),
    )

    return matches.map(toMatch)
  }

  return {
    search,
  }
}
