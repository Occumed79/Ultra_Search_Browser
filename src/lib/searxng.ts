// ─── SEARXNG INTEGRATION ───
// Private/self-hosted metasearch transport for Ultra Search.

import type { ScrapedResult } from '../types/search'

export { SEARXNG_WEB_ENGINES } from './searxng-engines'

export interface SearXNGResult {
  title?: string
  url?: string
  content?: string
  engine?: string
  engines?: string[]
  score?: number
  category?: string
}

export interface SearXNGSearchOptions {
  safeSearch?: boolean
  preferredLanguage?: string
  region?: string
  engines?: string[]
  maxResults?: number
  timeoutMs?: number
}

export interface SearXNGSearchResponse {
  text: string
  results: ScrapedResult[]
  engines: string[]
  configured: boolean
  ok: boolean
  error?: string
}

/** Resolve and validate SEARXNG_URL while preserving an optional path prefix. */
export function resolveSearxngBase(): string | null {
  const raw = process.env.SEARXNG_URL?.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password || !u.hostname) return null
    const pathname = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.host}${pathname}`
  } catch {
    return null
  }
}

export function isSearxngConfigured(): boolean {
  return resolveSearxngBase() !== null
}

function sourceEngines(result: SearXNGResult): string[] {
  const values = [
    ...(Array.isArray(result.engines) ? result.engines : []),
    ...(result.engine ? [result.engine] : []),
  ]
    .map(value => String(value).trim())
    .filter(Boolean)
  return Array.from(new Set(values))
}

function normalizeResult(result: SearXNGResult, index: number): ScrapedResult | null {
  const title = String(result.title || '').trim()
  const rawUrl = String(result.url || '').trim()
  if (!title || !rawUrl) return null

  let domain = ''
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    domain = parsed.hostname.replace(/^www\./, '')
    if (!domain) return null
  } catch {
    return null
  }

  const engines = sourceEngines(result)
  const engineLabel = engines.length > 0 ? engines.join(' + ') : 'metasearch'
  const score = Number.isFinite(Number(result.score))
    ? Math.max(0, Math.min(100, Number(result.score) * 20))
    : Math.max(10, 100 - index * 2)

  return {
    url: rawUrl,
    title: title.slice(0, 500),
    description: String(result.content || '').trim().slice(0, 2_000),
    domain,
    source: `SearXNG · ${engineLabel}`,
    rank: index + 1,
    score,
  }
}

/**
 * Query a private SearXNG instance through its JSON Search API.
 * Search API keys are not required. By default Ultra Search lets the private
 * SearXNG deployment choose its own enabled general engines. Callers can still
 * provide an explicit engine list when a targeted diagnostic/search needs it.
 */
export async function searchSearXNG(
  query: string,
  options: SearXNGSearchOptions = {}
): Promise<SearXNGSearchResponse> {
  const base = resolveSearxngBase()
  if (!base) {
    return {
      text: '',
      results: [],
      engines: [],
      configured: false,
      ok: false,
      error: 'SEARXNG_URL is not configured.',
    }
  }

  const requestedEngines = Array.from(new Set(
    (options.engines || [])
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  ))

  try {
    const url = new URL(`${base}/search`)
    url.searchParams.set('q', query.slice(0, 500))
    url.searchParams.set('format', 'json')
    url.searchParams.set('categories', 'general')
    if (requestedEngines.length > 0) {
      url.searchParams.set('engines', requestedEngines.join(','))
    }
    url.searchParams.set('safesearch', options.safeSearch === false ? '0' : '2')
    if (options.preferredLanguage) url.searchParams.set('language', options.preferredLanguage)

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(options.timeoutMs || 12_000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'UltraSearchBrowser/2.0',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      return {
        text: '',
        results: [],
        engines: requestedEngines,
        configured: true,
        ok: false,
        error: `SearXNG returned HTTP ${response.status}.`,
      }
    }

    const data = await response.json() as { results?: SearXNGResult[] }
    if (!Array.isArray(data.results)) {
      return {
        text: '',
        results: [],
        engines: requestedEngines,
        configured: true,
        ok: false,
        error: 'SearXNG returned an invalid result payload.',
      }
    }

    const maxResults = Math.max(1, Math.min(50, options.maxResults || 20))
    const normalized = data.results
      .map((result, index) => ({ result: normalizeResult(result, index), engines: sourceEngines(result) }))
      .filter((entry): entry is { result: ScrapedResult; engines: string[] } => entry.result != null)
      .slice(0, maxResults)

    const observedEngines = new Set<string>()
    normalized.forEach(entry => entry.engines.forEach(engine => observedEngines.add(engine)))
    const results = normalized.map((entry, index) => ({ ...entry.result, rank: index + 1 }))

    return {
      text: results.map(result => `${result.title} ${result.description}`).join(' '),
      results,
      engines: observedEngines.size > 0 ? Array.from(observedEngines) : requestedEngines,
      configured: true,
      ok: true,
    }
  } catch (error) {
    return {
      text: '',
      results: [],
      engines: requestedEngines,
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Check if the configured private SearXNG instance is reachable. */
export async function checkSearXNGAvailable(): Promise<boolean> {
  const base = resolveSearxngBase()
  if (!base) return false
  try {
    const response = await fetch(`${base}/config`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}
