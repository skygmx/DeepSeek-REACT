import pg from 'pg'

const { Pool } = pg

const poolDefaults = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
}

function resolveConnectionString(connectionString) {
  const resolved = connectionString ?? process.env.DATABASE_URL
  if (!resolved) {
    throw new Error('缺少 DATABASE_URL 环境变量')
  }
  return resolved
}

export function createPostgresPool(options = {}) {
  const { connectionString, ...poolOptions } = options

  return new Pool({
    ...poolDefaults,
    ...poolOptions,
    connectionString: resolveConnectionString(connectionString),
  })
}

export async function checkPostgresConnection(pool) {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_user AS user_name,
      EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'vector'
      ) AS has_vector
  `)

  return result.rows[0]
}

export async function closePostgresPool(pool) {
  await pool.end()
}
