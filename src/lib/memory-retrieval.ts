import type { ScrapedResult } from '../types/search'
import { hasDatabase, query } from './db'
import { createVectorStoreAdapter, type VectorStoreAdapter } from './vector-store'
import { generateEmbedding, isEmbeddingsReady } from './embeddings'

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    // drop fragments
    u.hash = ''
    // remove common tracking params
    u.searchParams.forEach((value, key) => {
      const k = key.toLowerCase()
      if (k.startsWith('utm_') || k === 'fbclid' || k === 'gclid') {
        u.searchParams.delete(key)
      }
    })
    // strip trailing slash
    let cleaned = u.toString().replace(/\/$/, '')
    return cleaned.toLowerCase()
  } catch (err) {
    // fallback: basic normalization
    return url.replace(/\/$/, '').toLowerCase()
  }
}

export function dedupeByUrl(results: ScrapedResult[]): ScrapedResult[] {
  const map = new Map<string, ScrapedResult>()
  for (const r of results) {
    const u = r.url ? normalizeUrl(r.url) : ''
    if (!map.has(u)) {
      map.set(u, r)
    } else {
      // keep the one with higher score
      const existing = map.get(u)!
      if ((r.score || 0) > (existing.score || 0)) {
        map.set(u, r)
      }
    }
  }
  return Array.from(map.values())
}

async function getPgVectorStore(): Promise<VectorStoreAdapter | null> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null
  try {
    const adapter = createVectorStoreAdapter('pgvector', databaseUrl)
    if ('initialize' in adapter) {
      try {
        await (adapter as any).initialize()
      } catch (e) {
        // ignore
      }
    }
    return adapter
  } catch (err) {
    console.warn('Failed to create pgvector adapter:', err)
    return null
  }
}

/**
 * Keyword search of stored results. Uses Postgres full-text search when available, falls back to ILIKE.
 * Returns ScrapedResult-compatible objects with source = 'memory-keyword'.
 */
export async function keywordSearchStoredResults(
  queryText: string,
  vertical?: string,
  operators?: any,
  limit = 20
): Promise<ScrapedResult[]> {
  if (!hasDatabase()) return []

  // Try full-text search first
  try {
    const tsQuery = queryText.replace(/\W+/g, ' ').trim()
    if (!tsQuery) return []

    // Build optional vertical filter
    const verticalFilter = vertical ? `AND (metadata->>'lens' = '${vertical}' OR $3::text IS NULL)` : ''

    const sql = `
      SELECT id, url, title, snippet, domain, source_engine, rank, metadata,
        ts_rank_cd(
          setweight(to_tsvector(coalesce(title,'')), 'A') ||
          setweight(to_tsvector(coalesce(snippet,'')), 'B') ||
          setweight(to_tsvector(coalesce(extracted_text,'')), 'C'),
          plainto_tsquery($1)
        ) as score
      FROM search_results
      WHERE (
        to_tsvector(coalesce(title,'')) || to_tsvector(coalesce(snippet,'')) || to_tsvector(coalesce(extracted_text,''))
      ) @@ plainto_tsquery($1)
      ${vertical ? "AND (metadata->>'lens' = $3)" : ''}
      ORDER BY score DESC, rank ASC
      LIMIT $2
    `

    const params = vertical ? [tsQuery, limit, vertical] : [tsQuery, limit]

    const res = await query(sql, params as any[])
    if (res && res.rows) {
      const out: ScrapedResult[] = res.rows.map((row: any, i: number) => ({
        title: row.title || '',
        url: row.url || '',
        description: row.snippet || '',
        domain: row.domain || (row.url ? new URL(row.url).hostname : ''),
        source: 'memory-keyword',
        rank: i + 1,
        score: row.score || 0,
      }))
      return out
    }
  } catch (err) {
    // Full-text search might not be available; fall back to ILIKE
    console.warn('Full-text search failed, falling back to ILIKE:', err)
  }

  // Fallback ILIKE search
  try {
    const like = `%${queryText}%`
    const sql = `
      SELECT id, url, title, snippet, domain, source_engine, rank, metadata
      FROM search_results
      WHERE (title ILIKE $1 OR snippet ILIKE $1 OR extracted_text ILIKE $1)
      ${vertical ? "AND (metadata->>'lens' = $2)" : ''}
      ORDER BY created_at DESC
      LIMIT $3
    `
    const params = vertical ? [like, vertical, limit] : [like, limit]
    const res = await query(sql, params as any[])
    if (res && res.rows) {
      const out: ScrapedResult[] = res.rows.map((row: any, i: number) => ({
        title: row.title || '',
        url: row.url || '',
        description: row.snippet || '',
        domain: row.domain || (row.url ? new URL(row.url).hostname : ''),
        source: 'memory-keyword',
        rank: i + 1,
        score: 1,
      }))
      return out
    }
  } catch (err) {
    console.warn('ILike keyword search failed:', err)
  }

  return []
}

/**
 * Vector search of stored results using pgvector via existing adapter.
 * Returns ScrapedResult-compatible objects with source = 'memory-vector'.
 */
export async function vectorSearchStoredResults(
  queryText: string,
  vertical?: string,
  limit = 10
): Promise<ScrapedResult[]> {
  // If no DB or no pgvector, return []
  const adapter = await getPgVectorStore()
  if (!adapter) return []

  // Generate embedding for query if possible
  let vector: number[] | undefined = undefined
  try {
    if (isEmbeddingsReady()) {
      vector = await generateEmbedding(queryText)
    } else {
      // still attempt; generateEmbedding may fallback to hash-based
      vector = await generateEmbedding(queryText)
    }
  } catch (err) {
    console.warn('Failed to generate embedding for query:', err)
    return []
  }

  if (!vector) return []

  try {
    const docs = await adapter.searchByVector(vector, limit)
    const out: ScrapedResult[] = docs.map((d, i) => ({
      title: d.metadata.title || '',
      url: d.metadata.url || d.id || '',
      description: d.text || '',
      domain: d.metadata.url ? new URL(d.metadata.url).hostname : (d.metadata.domain || ''),
      source: 'memory-vector',
      rank: i + 1,
      // Similarity is normalized to a bounded score so vector memory can influence
      // ordering without overpowering fresh government/PDF/procurement boosts.
      score: Math.max(0, Math.min(1, d.similarity ?? 0)) * 10,
    }))
    return out
  } catch (err) {
    console.warn('Vector search failed:', err)
    return []
  }
}
