import pg from 'pg'
import type { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool | null {
  if (pool) return pool
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    // Fail-open: database not configured
    return null
  }
  pool = new pg.Pool({ connectionString: databaseUrl, max: 5 })
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
  } catch (err) {
    console.error('Database query error')
    return null
  }
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T | null> {
  const p = getPool()
  if (!p) return null
  const client = await p.connect()
  try {
    return await fn(client)
  } catch (err) {
    console.error('Database client error')
    return null
  } finally {
    client.release()
  }
}
