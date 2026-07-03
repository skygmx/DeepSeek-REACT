import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = fileURLToPath(new URL('..', import.meta.url))
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
  doubaoAsrAppKey: process.env.DOUBAO_ASR_APP_KEY,
  doubaoAsrAccessKey: process.env.DOUBAO_ASR_ACCESS_KEY,
  doubaoAsrResourceId:
    process.env.DOUBAO_ASR_RESOURCE_ID ?? 'volc.bigasr.sauc.duration',
  doubaoAsrWsUrl:
    process.env.DOUBAO_ASR_WS_URL ??
    'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
}
