import pg from 'pg'
import type { Pool } from 'pg'

let pool: Pool | null = null

const DATABASE_CONNECT_TIMEOUT_MS = 5_000
const DATABASE_QUERY_TIMEOUT_MS = 8_000
const DATABASE_IDLE_TIMEOUT_MS = 30_000

function getPool(): Pool | null {
  if (pool) return pool
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null

  pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: DATABASE_IDLE_TIMEOUT_MS,
    query_timeout: DATABASE_QUERY_TIMEOUT_MS,
    statement_timeout: DATABASE_QUERY_TIMEOUT_MS,
  })
  return pool
}

export function hasDatabase(): boolean {
  return getPool() !== null
}

export async function query(text: string, params?: any[]) {
  const p = getPool()
  if (!p) return null
  try {
    return await p.query(text, params)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Database query failed: ${message.slice(0, 240)}`)
    return null
  }
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T | null> {
  const p = getPool()
  if (!p) return null

  let client: pg.PoolClient | undefined
  try {
    client = await p.connect()
    return await fn(client)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Database client operation failed: ${message.slice(0, 240)}`)
    return null
  } finally {
    client?.release()
  }
}
