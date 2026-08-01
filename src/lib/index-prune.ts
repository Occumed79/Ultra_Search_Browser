/**
 * Clean old non–Occu-Med rows from the local index.
 * Modes:
 *   prune  — delete entries that fail isOccuMedRelevant (keep the rest)
 *   clear  — delete all feed_entries (sources kept)
 *   wipe   — delete all entries + sources
 */

import pg from 'pg'
import { isOccuMedRelevant } from './occumed-index-filters'
import { getIndexStats, type IndexStats } from './small-web'

const { Pool: PgPool } = pg

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('DATABASE_URL is required')
    pool = new PgPool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=') || databaseUrl.includes('neon.tech')
        ? { rejectUnauthorized: false }
        : undefined,
      max: 4,
    })
  }
  return pool
}

function extractNaics(text: string): string | null {
  const m = text.match(/\bNAICS[:\s]*([0-9]{4,6})\b/i)
  return m?.[1] || null
}

export async function pruneNonOccuMedEntries(): Promise<{
  scanned: number
  deleted: number
  kept: number
  stats: IndexStats
}> {
  const client = getPool()
  const result = await client.query(
    `SELECT id, title, description, content FROM feed_entries`
  )
  let deleted = 0
  let kept = 0

  for (const row of result.rows) {
    const blob = `${row.title || ''} ${row.description || ''} ${row.content || ''}`
    const naics = extractNaics(blob)
    if (isOccuMedRelevant({ title: row.title, description: blob, naics })) {
      kept += 1
      continue
    }
    await client.query(`DELETE FROM feed_entries WHERE id = $1`, [row.id])
    deleted += 1
  }

  const stats = await getIndexStats()
  return { scanned: result.rows.length, deleted, kept, stats }
}

/** Delete all entries; leave feed_sources so bootstrap can refresh. */
export async function clearAllEntries(): Promise<{ deleted: number; stats: IndexStats }> {
  const client = getPool()
  const r = await client.query(`DELETE FROM feed_entries`)
  const stats = await getIndexStats()
  return { deleted: r.rowCount ?? 0, stats }
}

/** Delete entries and sources (full wipe). */
export async function wipeIndex(): Promise<{ entriesDeleted: number; sourcesDeleted: number; stats: IndexStats }> {
  const client = getPool()
  // entries first due to FK
  const e = await client.query(`DELETE FROM feed_entries`)
  const s = await client.query(`DELETE FROM feed_sources`)
  const stats = await getIndexStats()
  return {
    entriesDeleted: e.rowCount ?? 0,
    sourcesDeleted: s.rowCount ?? 0,
    stats,
  }
}
