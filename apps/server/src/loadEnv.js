import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'

const rootDir = fileURLToPath(new URL('../../..', import.meta.url))
const rootEnvPath = join(rootDir, '.env')

if (existsSync(rootEnvPath)) {
  loadDotenv({ path: rootEnvPath, quiet: true })
} else {
  loadDotenv({ quiet: true })
}
