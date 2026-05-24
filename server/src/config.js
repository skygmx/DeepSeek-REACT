import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = fileURLToPath(new URL('..', import.meta.url))
const rootDir = normalize(join(serverDir, '..'))

export const serverConfig = {
  port: Number(process.env.PORT ?? 3000),
  wsPath: '/ws/chat',
  rootDir,
  distDir: join(rootDir, 'dist'),
  deepSeekApiKey: process.env.DEEPSEEK_API_KEY,
  deepSeekApiUrl:
    process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/chat/completions',
}

