import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePostgresPool, createPostgresPool } from './postgres.js'

const migrationsDir = fileURLToPath(
  new URL('../../db/migrations/', import.meta.url),
)

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function getAppliedVersions(client) {
  const result = await client.query('SELECT version FROM schema_migrations')
  return new Set(result.rows.map((row) => row.version))
}

async function listMigrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

async function applyMigration(client, fileName) {
  const filePath = join(migrationsDir, fileName)
  const sql = await readFile(filePath, 'utf8')

  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1)',
      [basename(fileName)],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function runMigrations() {
  const pool = createPostgresPool()
  const client = await pool.connect()

  try {
    await ensureMigrationsTable(client)
    const appliedVersions = await getAppliedVersions(client)
    const migrationFiles = await listMigrationFiles()

    for (const fileName of migrationFiles) {
      if (appliedVersions.has(fileName)) {
        console.log(`skip ${fileName}`)
        continue
      }

      await applyMigration(client, fileName)
      console.log(`apply ${fileName}`)
    }

    console.log('database migrations complete')
  } finally {
    client.release()
    await closePostgresPool(pool)
  }
}

runMigrations().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
