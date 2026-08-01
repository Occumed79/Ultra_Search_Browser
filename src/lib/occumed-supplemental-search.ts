import {
  buyerLanguageRetrievalQueries,
  buyerLanguageSemanticQuery,
  buyerLanguageTermsForQuery,
  normalizeOccuMedLanguage,
} from './occumed-capability-matching'
import { hasDatabase, query as databaseQuery } from './db'
import {
  dedupeByUrl,
  keywordSearchStoredResults,
  vectorSearchStoredResults,
} from './memory-retrieval'
import { searchSmallWeb, type FeedEntry } from './small-web'
import type { ScrapedResult } from '../types/search'

const PARALLEL_ENDPOINT = 'https://api.parallel.ai/v1/search'
const PARALLEL_TIMEOUT_MS = 10_000
const LOCAL_INDEX_TIMEOUT_MS = 6_000

export interface OccuMedSupplementalSearchDiagnostics {
  queries: string[]
  parallel: {
    configured: boolean
    attempted: boolean
    successful: boolean
    resultCount: number
    keySlot?: number
    runtimeMs: number
    error?: string
  }
  keywordMatches: number
  vectorMatches: number
  metadataMatches: number
  smallWebMatches: number
  failures: string[]
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const cleaned = value.replace(/\s+/g, ' ').trim()
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function configuredParallelKeys(): string[] {
  const names = [
    'PARALLEL_API_KEY',
    'PARALLEL_API_KEY_SECONDARY',
    'PARALLEL_API_KEY_TERTIARY',
    'PARALLEL_API_KEY_QUATERNARY',
    ...Array.from({ length: 10 }, (_, index) => `PARALLEL_API_KEY_${index + 2}`),
  ]
  return unique([
    ...names.map(name => process.env[name] || ''),
    ...(process.env.PARALLEL_API_KEYS || '').split(/[\n,;]/),
  ].map(value => value.trim()))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim()
    if (Array.isArray(value)) {
      const joined = value.filter(item => typeof item === 'string').join(' ').replace(/\s+/g, ' ').trim()
      if (joined) return joined
    }
  }
  return ''
}

function normalizeParallelResults(payload: unknown, queries: string[]): ScrapedResult[] {
  const root = asRecord(payload)
  const results: ScrapedResult[] = []
  for (const item of asArray(root.results)) {
    const record = asRecord(item)
    const url = stringValue(record.url, record.link, record.id)
    const title = stringValue(record.title, record.name)
    if (!url || !title) continue
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue
      parsed.hash = ''
      results.push({
        title,
        url: parsed.toString().replace(/\/$/, ''),
        description: stringValue(
          record.description,
          record.snippet,
          record.summary,
          record.content,
          record.excerpts,
          record.snippets,
          record.highlights,
          record.text
        ).slice(0, 1_500),
        domain: parsed.hostname.replace(/^www\./, ''),
        source: 'Parallel Expanded Index',
        rank: results.length + 1,
        score: 0,
        retrieval: {
          sources: ['Parallel Expanded Index'],
          queries,
          purposes: ['parallel-expanded-index'],
          overlap: 1,
        },
      })
    } catch {
      // Ignore malformed links while preserving usable Parallel results.
    }
  }
  return dedupeByUrl(results)
}

async function searchParallelExpanded(
  query: string,
  queries: string[]
): Promise<{
  results: ScrapedResult[]
  diagnostics: OccuMedSupplementalSearchDiagnostics['parallel']
}> {
  const keys = configuredParallelKeys()
  if (keys.length === 0) {
    return {
      results: [],
      diagnostics: {
        configured: false,
        attempted: false,
        successful: false,
        resultCount: 0,
        runtimeMs: 0,
      },
    }
  }

  const aliases = buyerLanguageTermsForQuery(query, 8)
  const objective = [
    `Find active RFP, RFQ, solicitation, bid, tender, and sources-sought opportunities for ${query}.`,
    aliases.length > 0
      ? `Buyers may describe the same requirement as: ${aliases.join(', ')}.`
      : '',
    'Return actual procurement notices or solicitation documents, not generic service pages.',
  ].filter(Boolean).join(' ')

  let lastError = ''
  for (const [index, key] of keys.entries()) {
    const startedAt = Date.now()
    try {
      const response = await fetch(PARALLEL_ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          objective,
          search_queries: queries.slice(0, 4),
          max_chars_total: 16_000,
        }),
        signal: AbortSignal.timeout(PARALLEL_TIMEOUT_MS),
        cache: 'no-store',
      })
      const text = await response.text()
      let payload: unknown = {}
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        throw new Error('Parallel returned malformed JSON')
      }
      if (!response.ok) {
        const record = asRecord(payload)
        const detail = stringValue(record.error, record.message, record.detail)
        throw Object.assign(
          new Error(`Parallel returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`),
          { status: response.status }
        )
      }
      const results = normalizeParallelResults(payload, queries)
      return {
        results,
        diagnostics: {
          configured: true,
          attempted: true,
          successful: results.length > 0,
          resultCount: results.length,
          keySlot: index + 1,
          runtimeMs: Date.now() - startedAt,
          ...(results.length > 0 ? {} : { error: 'Parallel returned no usable procurement links' }),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = message.replace(key, '[redacted]').slice(0, 300)
      const status = typeof error === 'object' && error && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : undefined
      if (![401, 402, 403, 429].includes(status || 0)) {
        return {
          results: [],
          diagnostics: {
            configured: true,
            attempted: true,
            successful: false,
            resultCount: 0,
            keySlot: index + 1,
            runtimeMs: Date.now() - startedAt,
            error: lastError,
          },
        }
      }
    }
  }

  return {
    results: [],
    diagnostics: {
      configured: true,
      attempted: true,
      successful: false,
      resultCount: 0,
      runtimeMs: 0,
      error: lastError || 'Every configured Parallel key failed',
    },
  }
}

function meaningfulMetadataPatterns(query: string): string[] {
  const generic = new Set([
    'active', 'bid', 'bids', 'contract', 'current', 'find', 'health', 'medical',
    'open', 'opportunities', 'opportunity', 'procurement', 'program', 'proposal',
    'proposals', 'request', 'rfp', 'rfq', 'services', 'solicitation', 'tender',
  ])
  const phrases = unique([
    query,
    ...buyerLanguageTermsForQuery(query, 12),
  ])
  const tokens = unique(phrases.flatMap(value =>
    normalizeOccuMedLanguage(value)
      .split(' ')
      .filter(token => token.length >= 4 && !generic.has(token))
  ))
  return unique([
    ...phrases.map(value => `%${value}%`),
    ...tokens.map(value => `%${value}%`),
  ]).slice(0, 40)
}

async function searchStructuredMetadata(query: string, limit = 20): Promise<ScrapedResult[]> {
  if (!hasDatabase()) return []
  const patterns = meaningfulMetadataPatterns(query)
  if (patterns.length === 0) return []

  const response = await databaseQuery(
    `
      SELECT id, url, title, snippet, domain, rank, final_score, created_at
      FROM search_results
      WHERE metadata->>'verificationStatus' = 'valid'
        AND metadata->>'lens' = 'procurement'
        AND (
          metadata::text ILIKE ANY($1::text[])
          OR COALESCE(extracted_text, '') ILIKE ANY($1::text[])
        )
      ORDER BY final_score DESC NULLS LAST, created_at DESC
      LIMIT $2
    `,
    [patterns, limit]
  )
  if (!response?.rows) return []

  return response.rows
    .map((row: Record<string, unknown>, index: number): ScrapedResult => ({
      id: typeof row.id === 'string' ? row.id : undefined,
      title: typeof row.title === 'string' ? row.title : '',
      url: typeof row.url === 'string' ? row.url : '',
      description: typeof row.snippet === 'string' ? row.snippet : '',
      domain: typeof row.domain === 'string'
        ? row.domain
        : typeof row.url === 'string'
          ? (() => {
              try { return new URL(row.url).hostname.replace(/^www\./, '') } catch { return '' }
            })()
          : '',
      source: 'memory-metadata',
      rank: index + 1,
      score: Number(row.final_score || 0),
      bucket: 'valid',
      retrieval: {
        sources: ['memory-metadata'],
        queries: [query],
        purposes: ['structured-metadata'],
        overlap: 1,
      },
    }))
    .filter(result => Boolean(result.url && result.title))
}

function smallWebResult(entry: FeedEntry, index: number, sourceQuery: string): ScrapedResult | null {
  try {
    return {
      title: entry.title,
      url: entry.url,
      description: entry.description || entry.content || '',
      domain: new URL(entry.url).hostname.replace(/^www\./, ''),
      source: entry.category === 'procurement' ? 'procurement-index-expanded' : 'small-web-expanded',
      rank: index + 1,
      score: 0,
      retrieval: {
        sources: [entry.category === 'procurement' ? 'procurement-index-expanded' : 'small-web-expanded'],
        queries: [sourceQuery],
        purposes: ['buyer-language-index'],
        overlap: 1,
      },
    }
  } catch {
    return null
  }
}

export async function searchOccuMedSupplementalSources(
  query: string,
  options: { useVectorMemory: boolean }
): Promise<{
  results: ScrapedResult[]
  diagnostics: OccuMedSupplementalSearchDiagnostics
}> {
  const queries = buyerLanguageRetrievalQueries(query, 4)
  const failures: string[] = []

  const parallelPromise = searchParallelExpanded(query, queries)
  const keywordPromise = hasDatabase()
    ? withTimeout(
        Promise.all(queries.map(value => keywordSearchStoredResults(value, 'procurement', undefined, 10))),
        LOCAL_INDEX_TIMEOUT_MS,
        'expanded keyword index search'
      ).catch(error => {
        failures.push(error instanceof Error ? error.message : String(error))
        return [] as ScrapedResult[][]
      })
    : Promise.resolve([] as ScrapedResult[][])
  const vectorPromise = hasDatabase() && options.useVectorMemory
    ? withTimeout(
        vectorSearchStoredResults(buyerLanguageSemanticQuery(query), 'procurement', 12),
        LOCAL_INDEX_TIMEOUT_MS,
        'expanded vector index search'
      ).catch(error => {
        failures.push(error instanceof Error ? error.message : String(error))
        return [] as ScrapedResult[]
      })
    : Promise.resolve([] as ScrapedResult[])
  const metadataPromise = hasDatabase()
    ? withTimeout(
        searchStructuredMetadata(query, 20),
        LOCAL_INDEX_TIMEOUT_MS,
        'structured metadata search'
      ).catch(error => {
        failures.push(error instanceof Error ? error.message : String(error))
        return [] as ScrapedResult[]
      })
    : Promise.resolve([] as ScrapedResult[])
  const smallWebPromise = hasDatabase()
    ? withTimeout(
        Promise.all(queries.map(value => searchSmallWeb(value, 'procurement', 10))),
        LOCAL_INDEX_TIMEOUT_MS,
        'expanded procurement index search'
      ).catch(error => {
        failures.push(error instanceof Error ? error.message : String(error))
        return [] as FeedEntry[][]
      })
    : Promise.resolve([] as FeedEntry[][])

  const [parallel, keywordSets, vectorResults, metadataResults, smallWebSets] = await Promise.all([
    parallelPromise,
    keywordPromise,
    vectorPromise,
    metadataPromise,
    smallWebPromise,
  ])

  if (parallel.diagnostics.error) failures.push(`Parallel: ${parallel.diagnostics.error}`)
  const keywordResults = keywordSets.flat()
  const smallWebResults = smallWebSets.flatMap((entries, queryIndex) =>
    entries.map((entry, index) => smallWebResult(entry, index, queries[queryIndex] || query))
      .filter((result): result is ScrapedResult => result !== null)
  )
  const results = dedupeByUrl([
    ...parallel.results,
    ...keywordResults,
    ...vectorResults,
    ...metadataResults,
    ...smallWebResults,
  ])

  return {
    results,
    diagnostics: {
      queries,
      parallel: parallel.diagnostics,
      keywordMatches: keywordResults.length,
      vectorMatches: vectorResults.length,
      metadataMatches: metadataResults.length,
      smallWebMatches: smallWebResults.length,
      failures,
    },
  }
}
