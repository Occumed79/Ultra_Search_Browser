// ─── SEARXNG INTEGRATION ───
// Private/self-hosted metasearch transport for Ultra Search.

import type { ScrapedResult } from '../types/search'
import { SEARXNG_WEB_ENGINES } from './searxng-engines'

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

const DEFAULT_MIN_REQUEST_GAP_MS = 900
const DEFAULT_RETRY_DELAY_MS = 1_200
let searxRequestQueue: Promise<void> = Promise.resolve()
let lastSearxRequestStartedAt = 0

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

/**
 * Serialize calls to the private Render-hosted SearXNG instance. The search
 * route intentionally fans variants in parallel, but a single free SearXNG
 * instance can interpret that burst as abusive traffic and answer 429. Keeping
 * the throttle here protects every caller rather than relying on route-specific
 * wave sizing.
 */
async function withSearxRequestPermit<T>(run: () => Promise<T>): Promise<T> {
  let release!: () => void
  const previous = searxRequestQueue
  searxRequestQueue = new Promise<void>(resolve => { release = resolve })
  await previous

  try {
    const minGapMs = boundedInteger(
      process.env.SEARXNG_MIN_REQUEST_GAP_MS,
      DEFAULT_MIN_REQUEST_GAP_MS,
      0,
      5_000
    )
    const elapsed = Date.now() - lastSearxRequestStartedAt
    if (lastSearxRequestStartedAt > 0 && elapsed < minGapMs) {
      await sleep(minGapMs - elapsed)
    }
    lastSearxRequestStartedAt = Date.now()
    return await run()
  } finally {
    release()
  }
}

function retryDelayMs(response: Response): number {
  const configured = boundedInteger(
    process.env.SEARXNG_RETRY_DELAY_MS,
    DEFAULT_RETRY_DELAY_MS,
    0,
    5_000
  )
  const retryAfter = response.headers.get('Retry-After')?.trim()
  if (!retryAfter) return configured

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(5_000, Math.round(seconds * 1_000))
  }

  const retryAt = Date.parse(retryAfter)
  if (Number.isFinite(retryAt)) {
    return Math.max(0, Math.min(5_000, retryAt - Date.now()))
  }
  return configured
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

/**
 * The normal Ultra Search path explicitly requests its web-engine ensemble so
 * Google CSE, Bing, DuckDuckGo, Brave, Startpage, Qwant, Mojeek, and Yahoo are
 * attempted through SearXNG instead of depending on an unseen instance default.
 * SEARXNG_ENGINES may override the list for a deployment when necessary.
 */
export function configuredSearxngEngines(): string[] {
  const configured = String(process.env.SEARXNG_ENGINES || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(new Set(configured.length > 0 ? configured : [...SEARXNG_WEB_ENGINES]))
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
 * Search API keys are not required. The default primary request explicitly uses
 * Ultra Search's configured web-engine ensemble; callers may still supply an
 * alternate engine list for a targeted diagnostic/search.
 *
 * A transient 429/503 receives one bounded retry. Requests are serialized with
 * a small configurable gap because the free Render-hosted instance was observed
 * returning 429 when the planner sent three variants at once.
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
    (options.engines ?? configuredSearxngEngines())
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  ))

  const url = new URL(`${base}/search`)
  url.searchParams.set('q', query.slice(0, 500))
  url.searchParams.set('format', 'json')
  url.searchParams.set('categories', 'general')
  if (requestedEngines.length > 0) {
    url.searchParams.set('engines', requestedEngines.join(','))
  }
  url.searchParams.set('safesearch', options.safeSearch === false ? '0' : '2')
  if (options.preferredLanguage) url.searchParams.set('language', options.preferredLanguage)

  try {
    let response: Response | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await withSearxRequestPermit(() => fetch(url.toString(), {
        signal: AbortSignal.timeout(options.timeoutMs || 12_000),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'UltraSearchBrowser/2.0',
        },
        cache: 'no-store',
      }))

      if (response.ok) break
      if (attempt === 0 && [429, 503].includes(response.status)) {
        await sleep(retryDelayMs(response))
        continue
      }
      break
    }

    if (!response || !response.ok) {
      return {
        text: '',
        results: [],
        engines: requestedEngines,
        configured: true,
        ok: false,
        error: `SearXNG returned HTTP ${response?.status || 500} after bounded retry.`,
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
    const response = await withSearxRequestPermit(() => fetch(`${base}/config`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }))
    return response.ok
  } catch {
    return false
  }
}