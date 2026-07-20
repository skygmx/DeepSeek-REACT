import './loadEnv.js'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = fileURLToPath(new URL('../..', import.meta.url))
const rootDir = normalize(join(serverDir, '../..'))
const defaultDistDir = join(rootDir, 'apps/web/dist')

export const serverConfig = {
  port: Number(process.env.PORT ?? 3109),
  wsPaths: {
    chat: '/ws/chat',
    asr: '/ws/asr',
  },
  rootDir,
  distDir: process.env.WEB_DIST_DIR ?? defaultDistDir,
  databaseUrl: process.env.DATABASE_URL,
  deepSeekApiKey: process.env.DEEPSEEK_API_KEY,
  deepSeekApiUrl:
    process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/chat/completions',
  rag: {
    chunkOverlap: Number(process.env.RAG_CHUNK_OVERLAP ?? 200),
    chunkSize: Number(process.env.RAG_CHUNK_SIZE ?? 1000),
    distanceStrategy: process.env.RAG_DISTANCE_STRATEGY ?? 'cosine',
    embeddingApiKey: process.env.RAG_EMBEDDING_API_KEY,
    embeddingApiUrl:
      process.env.RAG_EMBEDDING_API_URL ??
      'https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal',
    embeddingDimensions: Number(process.env.RAG_EMBEDDING_DIMENSIONS ?? 2048),
    embeddingModel: process.env.RAG_EMBEDDING_MODEL,
    embeddingProvider: process.env.RAG_EMBEDDING_PROVIDER,
    retrieveLimit: Number(process.env.RAG_RETRIEVE_LIMIT ?? 5),
    vectorTableName: 'document_vector_chunks',
  },
  incidentFix: {
    baseBranch: process.env.INCIDENT_FIX_BASE_BRANCH ?? 'main',
    branchPrefix: process.env.INCIDENT_FIX_BRANCH_PREFIX ?? 'codex/incident-',
    defaultOwner: process.env.INCIDENT_FIX_DEFAULT_OWNER,
    enabled: process.env.INCIDENT_FIX_ENABLED === 'true',
    pollIntervalMs: Number(process.env.INCIDENT_POLL_INTERVAL_MS ?? 300_000),
    pollWindowMinutes: Number(process.env.INCIDENT_POLL_WINDOW_MINUTES ?? 10),
  },
  doubaoAsrAppKey: process.env.DOUBAO_ASR_APP_KEY,
  doubaoAsrAccessKey: process.env.DOUBAO_ASR_ACCESS_KEY,
  doubaoAsrResourceId:
    process.env.DOUBAO_ASR_RESOURCE_ID ?? 'volc.bigasr.sauc.duration',
  doubaoAsrWsUrl:
    process.env.DOUBAO_ASR_WS_URL ??
    'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
}
