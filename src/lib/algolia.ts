import { createHash } from 'node:crypto'
import type { ScrapedResult, SearchLens } from '../types/search'

const DEFAULT_INDEX_NAME = 'ultra_search_procurement'
const DEFAULT_TIMEOUT_MS = 6_000
const DEFAULT_MAX_RESULTS = 15

interface AlgoliaHit {
  objectID?: unknown
  title?: unknown
  url?: unknown
  description?: unknown
  domain?: unknown
  source?: unknown
  score?: unknown
  verifiedAt?: unknown
  lifecycleStatus?: unknown
}

interface AlgoliaSearchPayload {
  hits?: AlgoliaHit[]
  message?: unknown
}

interface AlgoliaBatchPayload {
  taskID?: unknown
  objectIDs?: unknown
  message?: unknown
}

export interface AlgoliaSearchResponse {
  configured: boolean
  ok: boolean
  results: ScrapedResult[]
  indexName: string
  error?: string
}

export interface AlgoliaIndexResponse {
  configured: boolean
  attempted: number
  indexed: number
  failed: number
  skipped?: boolean
  reason?: string
  taskId?: number
}

function clean(value: unknown, maxLength = 2_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function appId(): string {
  const value = String(process.env.ALGOLIA_APP_ID || '').trim()
  return /^[a-z0-9-]+$/i.test(value) ? value : ''
}

function indexName(): string {
  return clean(process.env.ALGOLIA_INDEX_NAME || DEFAULT_INDEX_NAME, 120) || DEFAULT_INDEX_NAME
}

function searchKey(): string {
  return String(process.env.ALGOLIA_SEARCH_API_KEY || '').trim()
}

function writeKey(): string {
  return String(process.env.ALGOLIA_WRITE_API_KEY || '').trim()
}

function apiHeaders(apiKey: string): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Algolia-Application-Id': appId(),
    'X-Algolia-API-Key': apiKey,
    'X-Algolia-Agent': 'UltraSearchBrowser/2.0',
  }
}

function safeHttpUrl(value: unknown): string | null {
  const raw = clean(value, 2_000)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function normalizeHit(hit: AlgoliaHit, index: number): ScrapedResult | null {
  const url = safeHttpUrl(hit.url)
  const title = clean(hit.title, 500)
  if (!url || !title) return null

  const parsed = new URL(url)
  const scoreValue = Number(hit.score)
  const score = Number.isFinite(scoreValue)
    ? Math.max(0, Math.min(100, scoreValue))
    : Math.max(10, 100 - index * 2)

  return {
    title,
    url,
    description: clean(hit.description, 2_000),
    domain: clean(hit.domain, 300) || parsed.hostname.replace(/^www\./, '').toLowerCase(),
    source: 'Algolia memory',
    rank: index + 1,
    score,
    resultType: 'procurement',
  }
}

function objectIdFor(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex').slice(0, 32)
}

function verifiedRecord(result: ScrapedResult, lens: SearchLens) {
  const url = safeHttpUrl(result.url)
  if (!url) return null

  return {
    objectID: objectIdFor(url),
    title: clean(result.title, 500),
    url,
    description: clean(result.description, 2_000),
    domain: clean(result.domain, 300),
    source: clean(result.source, 200),
    score: Number.isFinite(result.score) ? result.score : 0,
    rank: Number.isFinite(result.rank) ? result.rank : 0,
    lens,
    verifiedAt: result.pageValidation?.checkedAt || new Date().toISOString(),
    lifecycleStatus: result.pageValidation?.lifecycle?.status || 'unknown',
    retrievalSources: result.retrieval?.sources || [],
    retrievalQueries: result.retrieval?.queries || [],
    matchedConcepts: result.validation?.matchedConcepts || [],
  }
}

export function isAlgoliaSearchConfigured(): boolean {
  return Boolean(appId() && indexName() && searchKey())
}

export function isAlgoliaWriteConfigured(): boolean {
  return Boolean(appId() && indexName() && writeKey())
}

export function algoliaIndexName(): string {
  return indexName()
}

export async function searchAlgoliaMemory(
  query: string,
  options: { maxResults?: number; timeoutMs?: number } = {}
): Promise<AlgoliaSearchResponse> {
  const selectedIndex = indexName()
  if (!isAlgoliaSearchConfigured()) {
    return {
      configured: false,
      ok: false,
      results: [],
      indexName: selectedIndex,
      error: 'ALGOLIA_APP_ID and ALGOLIA_SEARCH_API_KEY are required for Algolia memory search.',
    }
  }

  const normalizedQuery = clean(query, 500)
  if (!normalizedQuery) {
    return {
      configured: true,
      ok: false,
      results: [],
      indexName: selectedIndex,
      error: 'Algolia memory query is empty.',
    }
  }

  const maxResults = Math.max(1, Math.min(50, positiveInteger(options.maxResults || process.env.ALGOLIA_MAX_RESULTS, DEFAULT_MAX_RESULTS)))
  const timeoutMs = Math.max(1_000, Math.min(15_000, positiveInteger(options.timeoutMs || process.env.ALGOLIA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)))
  const endpoint = `https://${appId()}-dsn.algolia.net/1/indexes/${encodeURIComponent(selectedIndex)}/query`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: apiHeaders(searchKey()),
      body: JSON.stringify({
        query: normalizedQuery,
        hitsPerPage: maxResults,
        attributesToRetrieve: [
          'objectID', 'title', 'url', 'description', 'domain', 'source', 'score',
          'verifiedAt', 'lifecycleStatus',
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => null) as AlgoliaSearchPayload | null
    if (response.status === 404) {
      return { configured: true, ok: true, results: [], indexName: selectedIndex }
    }
    if (!response.ok) {
      const detail = clean(payload?.message, 300)
      return {
        configured: true,
        ok: false,
        results: [],
        indexName: selectedIndex,
        error: detail ? `Algolia returned HTTP ${response.status}: ${detail}` : `Algolia returned HTTP ${response.status}.`,
      }
    }

    const hits = Array.isArray(payload?.hits) ? payload.hits : []
    const results = hits
      .map((hit, index) => normalizeHit(hit, index))
      .filter((result): result is ScrapedResult => result != null)
      .slice(0, maxResults)
      .map((result, index) => ({ ...result, rank: index + 1 }))

    return { configured: true, ok: true, results, indexName: selectedIndex }
  } catch (error) {
    return {
      configured: true,
      ok: false,
      results: [],
      indexName: selectedIndex,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function indexVerifiedResultsInAlgolia(
  results: ScrapedResult[],
  lens: SearchLens,
  maxResults = 30,
  timeoutMs = 2_500
): Promise<AlgoliaIndexResponse> {
  if (!isAlgoliaWriteConfigured()) {
    return {
      configured: false,
      attempted: 0,
      indexed: 0,
      failed: 0,
      skipped: true,
      reason: 'ALGOLIA_APP_ID and ALGOLIA_WRITE_API_KEY are required for Algolia indexing.',
    }
  }

  const records = results
    .slice(0, Math.max(1, Math.min(50, maxResults)))
    .map(result => verifiedRecord(result, lens))
    .filter((record): record is NonNullable<ReturnType<typeof verifiedRecord>> => record != null)

  if (records.length === 0) {
    return {
      configured: true,
      attempted: 0,
      indexed: 0,
      failed: 0,
      skipped: true,
      reason: 'No verified results were eligible for Algolia indexing.',
    }
  }

  const selectedIndex = indexName()
  const endpoint = `https://${appId()}.algolia.net/1/indexes/${encodeURIComponent(selectedIndex)}/batch`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: apiHeaders(writeKey()),
      body: JSON.stringify({
        requests: records.map(record => ({ action: 'updateObject', body: record })),
      }),
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, timeoutMs))),
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => null) as AlgoliaBatchPayload | null
    if (!response.ok) {
      return {
        configured: true,
        attempted: records.length,
        indexed: 0,
        failed: records.length,
        reason: clean(payload?.message, 300) || `Algolia returned HTTP ${response.status}.`,
      }
    }

    const taskId = Number(payload?.taskID)
    return {
      configured: true,
      attempted: records.length,
      indexed: records.length,
      failed: 0,
      ...(Number.isFinite(taskId) ? { taskId } : {}),
    }
  } catch (error) {
    return {
      configured: true,
      attempted: records.length,
      indexed: 0,
      failed: records.length,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
