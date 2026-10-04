/** Read-only connection to the existing canonical Neon profile. */
import pg from 'pg'
let pool: pg.Pool | null = null
export function isOccuMedAwareConfigured(): boolean {
  return Boolean(process.env.OCCU_MED_AWARE_DATABASE_URL?.trim())
}
function getPool(): pg.Pool {
  if (pool) return pool
  const connectionString = process.env.OCCU_MED_AWARE_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OCCU_MED_AWARE_DATABASE_URL is not configured')
  pool = new pg.Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 })
  pool.on('error', () => console.warn('Canonical relevance database connection failed'))
  return pool
}
export async function queryOccuMedAware<T = Record<string, unknown>>(sql: string, params: unknown[] = [], timeoutMs = 6_000): Promise<T[]> {
  const client = await getPool().connect()
  try {
    await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`)
    return (await client.query(sql, params)).rows as T[]
  } finally { client.release() }
}
