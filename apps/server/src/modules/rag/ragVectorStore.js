import { PGVectorStore } from '@langchain/pgvector'
import { createRagEmbeddings } from './embeddings/createRagEmbeddings.js'

const vectorColumns = {
  contentColumnName: 'content',
  idColumnName: 'id',
  metadataColumnName: 'metadata',
  vectorColumnName: 'vector',
}

function createVectorStore({ config, pool }) {
  const embeddings = createRagEmbeddings({
    apiKey: config.embeddingApiKey,
    apiUrl: config.embeddingApiUrl,
    dimensions: config.embeddingDimensions,
    model: config.embeddingModel,
    provider: config.embeddingProvider,
  })

  return new PGVectorStore(embeddings, {
    columns: vectorColumns,
    distanceStrategy: config.distanceStrategy,
    pool,
    scoreNormalization: 'similarity',
    skipInitializationCheck: true,
    tableName: config.vectorTableName,
  })
}

export function createRagVectorStoreFactory({ config, pool }) {
  let vectorStorePromise = null

  return async function getRagVectorStore() {
    vectorStorePromise ??= Promise.resolve(createVectorStore({ config, pool }))

    try {
      return await vectorStorePromise
    } catch (error) {
      vectorStorePromise = null
      throw error
    }
  }
}
