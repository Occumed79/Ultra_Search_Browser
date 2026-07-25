import type { ScrapedResult } from '../types/search'
import { hasDatabase, query } from './db'
import { createVectorStoreAdapter, type SearchDocument, type VectorStoreAdapter } from './vector-store'
import { generateEmbedding, isEmbeddingsReady } from './embeddings'

const MIN_VECTOR_MEMORY_SIMILARITY = 0.64

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    u.searchParams.forEach((_value, key) => {
      const k = key.toLowerCase()
      if (k.startsWith('utm_') || k === 'fbclid' || k === 'gclid') {
        u.searchParams.delete(key)
      }
    })
    return u.toString().replace(/\/$/, '').toLowerCase()
  } catch {
    return url.replace(/\/$/, '').toLowerCase()
  }
}

export function dedupeByUrl(results: ScrapedResult[]): ScrapedResult[] {
  const map = new Map<string, ScrapedResult>()
  for (const result of results) {
    const normalized = result.url ? normalizeUrl(result.url) : ''
    if (!normalized) continue
    if (!map.has(normalized)) {
      map.set(normalized, result)
    } else {
      const existing = map.get(normalized) as ScrapedResult
      if ((result.score || 0) > (existing.score || 0)) map.set(normalized, result)
    }
  }
  return Array.from(map.values())
}

async function getPgVectorStore(): Promise<VectorStoreAdapter | null> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null
  try {
    const adapter = createVectorStoreAdapter('pgvector', databaseUrl)
    const initializable = adapter as VectorStoreAdapter & { initialize?: () => Promise<void> }
    if (typeof initializable.initialize === 'function') {
      try {
        await initializable.initialize()
      } catch {
        // The adapter search call will surface a meaningful failure when initialization is required.
      }
    }
    return adapter
  } catch (error) {
    console.warn('Failed to create pgvector adapter:', error)
    return null
  }
}

function verifiedMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  return (metadata as Record<string, unknown>).verificationStatus === 'valid'
}

/**
 * Keyword search of verified stored results. Candidate rows and legacy rows
 * without explicit verification metadata are intentionally excluded.
 */
export async function keywordSearchStoredResults(
  queryText: string,
  vertical?: string,
  _operators?: unknown,
  limit = 20
): Promise<ScrapedResult[]> {
  if (!hasDatabase()) return []

  try {
    const tsQuery = queryText.replace(/\W+/g, ' ').trim()
    if (!tsQuery) return []

    const sql = vertical
      ? `
        SELECT id, url, title, snippet, domain, source_engine, rank, metadata,
          ts_rank_cd(
            setweight(to_tsvector(coalesce(title,'')), 'A') ||
            setweight(to_tsvector(coalesce(snippet,'')), 'B') ||
            setweight(to_tsvector(coalesce(extracted_text,'')), 'C'),
            plainto_tsquery($1)
          ) AS score
        FROM search_results
        WHERE metadata->>'verificationStatus' = 'valid'
          AND metadata->>'lens' = $3
          AND (
            to_tsvector(coalesce(title,'')) ||
            to_tsvector(coalesce(snippet,'')) ||
            to_tsvector(coalesce(extracted_text,''))
          ) @@ plainto_tsquery($1)
        ORDER BY score DESC, rank ASC
        LIMIT $2
      `
      : `
        SELECT id, url, title, snippet, domain, source_engine, rank, metadata,
          ts_rank_cd(
            setweight(to_tsvector(coalesce(title,'')), 'A') ||
            setweight(to_tsvector(coalesce(snippet,'')), 'B') ||
            setweight(to_tsvector(coalesce(extracted_text,'')), 'C'),
            plainto_tsquery($1)
          ) AS score
        FROM search_results
        WHERE metadata->>'verificationStatus' = 'valid'
          AND (
            to_tsvector(coalesce(title,'')) ||
            to_tsvector(coalesce(snippet,'')) ||
            to_tsvector(coalesce(extracted_text,''))
          ) @@ plainto_tsquery($1)
        ORDER BY score DESC, rank ASC
        LIMIT $2
      `

    const params = vertical ? [tsQuery, limit, vertical] : [tsQuery, limit]
    const response = await query(sql, params)
    if (response?.rows) {
      return response.rows
        .map((row: Record<string, unknown>, index: number): ScrapedResult => ({
          id: typeof row.id === 'string' ? row.id : undefined,
          title: typeof row.title === 'string' ? row.title : '',
          url: typeof row.url === 'string' ? row.url : '',
          description: typeof row.snippet === 'string' ? row.snippet : '',
          domain: typeof row.domain === 'string'
            ? row.domain
            : typeof row.url === 'string'
              ? new URL(row.url).hostname
              : '',
          source: 'memory-keyword',
          rank: index + 1,
          score: Number(row.score || 0),
          bucket: 'valid',
        }))
        .filter(result => Boolean(result.url && result.title))
    }
  } catch (error) {
    console.warn('Verified full-text memory search failed, falling back to ILIKE:', error)
  }

  try {
    const like = `%${queryText}%`
    const sql = vertical
      ? `
        SELECT id, url, title, snippet, domain, source_engine, rank, metadata
        FROM search_results
        WHERE metadata->>'verificationStatus' = 'valid'
          AND metadata->>'lens' = $2
          AND (title ILIKE $1 OR snippet ILIKE $1 OR extracted_text ILIKE $1)
        ORDER BY created_at DESC
        LIMIT $3
      `
      : `
        SELECT id, url, title, snippet, domain, source_engine, rank, metadata
        FROM search_results
        WHERE metadata->>'verificationStatus' = 'valid'
          AND (title ILIKE $1 OR snippet ILIKE $1 OR extracted_text ILIKE $1)
        ORDER BY created_at DESC
        LIMIT $2
      `
    const params = vertical ? [like, vertical, limit] : [like, limit]
    const response = await query(sql, params)
    if (response?.rows) {
      return response.rows
        .map((row: Record<string, unknown>, index: number): ScrapedResult => ({
          id: typeof row.id === 'string' ? row.id : undefined,
          title: typeof row.title === 'string' ? row.title : '',
          url: typeof row.url === 'string' ? row.url : '',
          description: typeof row.snippet === 'string' ? row.snippet : '',
          domain: typeof row.domain === 'string'
            ? row.domain
            : typeof row.url === 'string'
              ? new URL(row.url).hostname
              : '',
          source: 'memory-keyword',
          rank: index + 1,
          score: 1,
          bucket: 'valid',
        }))
        .filter(result => Boolean(result.url && result.title))
    }
  } catch (error) {
    console.warn('Verified ILIKE memory search failed:', error)
  }

  return []
}

/**
 * Vector search of verified pgvector documents. Legacy documents and weak
 * semantic matches are excluded so stale unrelated memory cannot dominate
 * fresh public retrieval.
 */
export async function vectorSearchStoredResults(
  queryText: string,
  vertical?: string,
  limit = 10
): Promise<ScrapedResult[]> {
  const adapter = await getPgVectorStore()
  if (!adapter) return []

  let vector: number[]
  try {
    vector = isEmbeddingsReady()
      ? await generateEmbedding(queryText)
      : await generateEmbedding(queryText)
  } catch (error) {
    console.warn('Failed to generate embedding for query:', error)
    return []
  }

  try {
    const docs = await adapter.searchByVector(vector, Math.max(limit * 4, 30))
    return docs
      .filter((document: SearchDocument) => {
        const similarity = Number(document.similarity || 0)
        return verifiedMetadata(document.metadata)
          && (!vertical || document.metadata.lens === vertical)
          && similarity >= MIN_VECTOR_MEMORY_SIMILARITY
      })
      .slice(0, limit)
      .map((document, index): ScrapedResult => ({
        title: document.metadata.title || '',
        url: document.metadata.url || document.id || '',
        description: document.text || '',
        domain: document.metadata.url
          ? new URL(document.metadata.url).hostname
          : document.metadata.domain || '',
        source: 'memory-vector',
        rank: index + 1,
        score: Math.max(0, Math.min(1, document.similarity ?? 0)) * 10,
        bucket: 'valid',
      }))
      .filter(result => Boolean(result.url && result.title))
  } catch (error) {
    console.warn('Verified vector memory search failed:', error)
    return []
  }
}
