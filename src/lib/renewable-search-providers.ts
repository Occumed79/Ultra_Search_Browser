import type { ScrapedResult } from '../types/search'
import {
  providerKeyCount,
  rotatingProviderKeys,
} from './provider-key-pool'

const TAVILY_KEYS = [
  'TAVILY_API_KEY',
  'TAVILY_API_KEY_2',
  'TAVILY_API_KEY_3',
  'TAVILY_API_KEY_4',
]
const EXA_KEYS = [
  'EXA_SEARCH_API_KEY',
  'EXA_SEARCH_API_KEY_2',
  'EXA_SEARCH_API_KEY_3',
  'EXA_SEARCH_API_KEY_4',
]
const LANGSEARCH_KEYS = ['LANGSEARCH_API_KEY']
const TINYFISH_KEYS = ['TINYFISH_API_KEY']

const DEFAULT_TIMEOUT_MS = 10_000
const EXA_FREE_RESULT_CEILING = 10

export interface RenewableSearchOptions {
  maxResults?: number
  timeoutMs?: number
  purpose?: string
}

export interface RenewableSearchResponse {
  text: string
  results: ScrapedResult[]
  configured: boolean
  ok: boolean
  keyCount: number
  error?: string
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizedQuery(query: string): string {
  return String(query || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function normalizeHttpUrl(value: unknown): string | null {
  const raw = String(value || '').trim()
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

function cleanText(value: unknown, maxLength = 2_000): string {
  if (Array.isArray(value)) return cleanText(value.join(' '), maxLength)
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function buildResult(
  source: string,
  titleValue: unknown,
  urlValue: unknown,
  descriptionValue: unknown,
  index: number,
  scoreValue?: unknown
): ScrapedResult | null {
  const title = cleanText(titleValue, 500)
  const url = normalizeHttpUrl(urlValue)
  if (!title || !url) return null

  const parsed = new URL(url)
  const numericScore = Number(scoreValue)
  const score = Number.isFinite(numericScore)
    ? numericScore <= 1
      ? Math.max(1, Math.min(100, numericScore * 100))
      : Math.max(1, Math.min(100, numericScore))
    : Math.max(10, 100 - index * 2)

  return {
    title,
    url,
    description: cleanText(descriptionValue),
    domain: parsed.hostname.replace(/^www\./, '').toLowerCase(),
    source,
    rank: index + 1,
    score,
  }
}

function timeoutMs(options: RenewableSearchOptions): number {
  return Math.max(1_000, Math.min(20_000, positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)))
}

function maxResults(options: RenewableSearchOptions, ceiling = 20): number {
  return Math.max(1, Math.min(ceiling, positiveInteger(options.maxResults, Math.min(10, ceiling))))
}

function retryableStatus(status: number): boolean {
  return [401, 402, 403, 429, 432, 433].includes(status)
}

function failure(
  configured: boolean,
  keyCount: number,
  error: string
): RenewableSearchResponse {
  return { text: '', results: [], configured, ok: false, keyCount, error }
}

function success(results: ScrapedResult[], keyCount: number): RenewableSearchResponse {
  return {
    text: results.map(result => `${result.title} ${result.description}`).join(' '),
    results,
    configured: true,
    ok: true,
    keyCount,
  }
}

export function isTavilyConfigured(): boolean {
  return providerKeyCount(TAVILY_KEYS) > 0
}

export function tavilyKeyCount(): number {
  return providerKeyCount(TAVILY_KEYS)
}

export async function searchTavily(
  query: string,
  options: RenewableSearchOptions = {}
): Promise<RenewableSearchResponse> {
  const keys = rotatingProviderKeys('tavily', TAVILY_KEYS, TAVILY_KEYS.length)
  const keyCount = providerKeyCount(TAVILY_KEYS)
  if (keys.length === 0) return failure(false, 0, 'No TAVILY_API_KEY values are configured.')

  const q = normalizedQuery(query)
  if (!q) return failure(true, keyCount, 'Tavily query is empty.')
  let lastError = 'Tavily search failed.'

  for (const slot of keys) {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${slot.value}`,
          'User-Agent': 'UltraSearchBrowser/2.0',
        },
        body: JSON.stringify({
          query: q,
          search_depth: 'basic',
          max_results: maxResults(options, 20),
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
        signal: AbortSignal.timeout(timeoutMs(options)),
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => null) as {
        results?: Array<{ title?: unknown; url?: unknown; content?: unknown; score?: unknown }>
        detail?: unknown
        message?: unknown
      } | null

      if (!response.ok) {
        const detail = cleanText(payload?.detail || payload?.message, 300)
        lastError = `Tavily returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`
        if (retryableStatus(response.status)) continue
        return failure(true, keyCount, lastError)
      }

      const results = (Array.isArray(payload?.results) ? payload.results : [])
        .map((row, index) => buildResult('Tavily', row.title, row.url, row.content, index, row.score))
        .filter((result): result is ScrapedResult => result != null)
        .slice(0, maxResults(options, 20))
        .map((result, index) => ({ ...result, rank: index + 1 }))

      return success(results, keyCount)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return failure(true, keyCount, lastError)
}

export function isExaConfigured(): boolean {
  return providerKeyCount(EXA_KEYS) > 0
}

export function exaKeyCount(): number {
  return providerKeyCount(EXA_KEYS)
}

export async function searchExa(
  query: string,
  options: RenewableSearchOptions = {}
): Promise<RenewableSearchResponse> {
  const keys = rotatingProviderKeys('exa', EXA_KEYS, EXA_KEYS.length)
  const keyCount = providerKeyCount(EXA_KEYS)
  if (keys.length === 0) return failure(false, 0, 'No EXA_SEARCH_API_KEY values are configured.')

  const q = normalizedQuery(query)
  if (!q) return failure(true, keyCount, 'Exa query is empty.')
  let lastError = 'Exa search failed.'
  const resultLimit = maxResults(options, EXA_FREE_RESULT_CEILING)

  for (const slot of keys) {
    try {
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': slot.value,
          'User-Agent': 'UltraSearchBrowser/2.0',
        },
        body: JSON.stringify({
          query: q,
          type: 'auto',
          numResults: resultLimit,
          contents: {
            highlights: { dynamic: true },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs(options)),
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => null) as {
        results?: Array<{
          title?: unknown
          url?: unknown
          text?: unknown
          highlights?: unknown
          publishedDate?: unknown
          score?: unknown
        }>
        error?: unknown
        message?: unknown
      } | null

      if (!response.ok) {
        const detail = cleanText(payload?.message || payload?.error, 300)
        lastError = `Exa returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`
        if (retryableStatus(response.status)) continue
        return failure(true, keyCount, lastError)
      }

      const results = (Array.isArray(payload?.results) ? payload.results : [])
        .map((row, index) => buildResult(
          'Exa',
          row.title,
          row.url,
          row.highlights || row.text || row.publishedDate,
          index,
          row.score
        ))
        .filter((result): result is ScrapedResult => result != null)
        .slice(0, resultLimit)
        .map((result, index) => ({ ...result, rank: index + 1 }))

      return success(results, keyCount)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return failure(true, keyCount, lastError)
}

export function isLangSearchConfigured(): boolean {
  return providerKeyCount(LANGSEARCH_KEYS) > 0
}

export function langSearchKeyCount(): number {
  return providerKeyCount(LANGSEARCH_KEYS)
}

export async function searchLangSearch(
  query: string,
  options: RenewableSearchOptions = {}
): Promise<RenewableSearchResponse> {
  const keys = rotatingProviderKeys('langsearch', LANGSEARCH_KEYS, 1)
  const keyCount = providerKeyCount(LANGSEARCH_KEYS)
  if (keys.length === 0) return failure(false, 0, 'LANGSEARCH_API_KEY is not configured.')

  const q = normalizedQuery(query)
  if (!q) return failure(true, keyCount, 'LangSearch query is empty.')

  try {
    const response = await fetch('https://api.langsearch.com/v1/web-search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keys[0].value}`,
        'User-Agent': 'UltraSearchBrowser/2.0',
      },
      body: JSON.stringify({
        query: q,
        freshness: 'noLimit',
        summary: false,
        count: maxResults(options, 20),
      }),
      signal: AbortSignal.timeout(timeoutMs(options)),
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => null) as {
      code?: unknown
      msg?: unknown
      data?: {
        webPages?: {
          value?: Array<{
            name?: unknown
            url?: unknown
            snippet?: unknown
            summary?: unknown
          }>
        }
      }
    } | null

    if (!response.ok || (typeof payload?.code === 'number' && payload.code >= 400)) {
      const status = response.ok ? Number(payload?.code) || 500 : response.status
      const detail = cleanText(payload?.msg, 300)
      return failure(true, keyCount, `LangSearch returned HTTP ${status}${detail ? `: ${detail}` : '.'}`)
    }

    const rows = payload?.data?.webPages?.value
    const results = (Array.isArray(rows) ? rows : [])
      .map((row, index) => buildResult('LangSearch', row.name, row.url, row.snippet || row.summary, index))
      .filter((result): result is ScrapedResult => result != null)
      .slice(0, maxResults(options, 20))
      .map((result, index) => ({ ...result, rank: index + 1 }))

    return success(results, keyCount)
  } catch (error) {
    return failure(true, keyCount, error instanceof Error ? error.message : String(error))
  }
}

export function isTinyFishConfigured(): boolean {
  return providerKeyCount(TINYFISH_KEYS) > 0
}

export function tinyFishKeyCount(): number {
  return providerKeyCount(TINYFISH_KEYS)
}

export async function searchTinyFish(
  query: string,
  options: RenewableSearchOptions = {}
): Promise<RenewableSearchResponse> {
  const keys = rotatingProviderKeys('tinyfish', TINYFISH_KEYS, 1)
  const keyCount = providerKeyCount(TINYFISH_KEYS)
  if (keys.length === 0) return failure(false, 0, 'TINYFISH_API_KEY is not configured.')

  const q = normalizedQuery(query)
  if (!q) return failure(true, keyCount, 'TinyFish query is empty.')

  const endpoint = new URL('https://api.search.tinyfish.ai')
  endpoint.searchParams.set('query', q)
  endpoint.searchParams.set('location', 'US')
  endpoint.searchParams.set('language', 'en')

  try {
    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': keys[0].value,
        'User-Agent': 'UltraSearchBrowser/2.0',
      },
      signal: AbortSignal.timeout(timeoutMs(options)),
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => null) as {
      results?: Array<{
        position?: unknown
        site_name?: unknown
        title?: unknown
        snippet?: unknown
        url?: unknown
      }>
      error?: unknown
      message?: unknown
    } | null

    if (!response.ok) {
      const detail = cleanText(payload?.message || payload?.error, 300)
      return failure(true, keyCount, `TinyFish returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`)
    }

    const results = (Array.isArray(payload?.results) ? payload.results : [])
      .map((row, index) => buildResult('TinyFish', row.title, row.url, row.snippet, index))
      .filter((result): result is ScrapedResult => result != null)
      .slice(0, maxResults(options, 20))
      .map((result, index) => ({ ...result, rank: index + 1 }))

    return success(results, keyCount)
  } catch (error) {
    return failure(true, keyCount, error instanceof Error ? error.message : String(error))
  }
}