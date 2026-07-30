import { searchBingHTML, searchDuckDuckGo, type SearchEngineOptions } from './search'
import { isUsableExternalResult, parseBingRss, parseDuckDuckGoLite } from './search-response-parsers'
import type { ScrapedResult } from '../types/search'

const FALLBACK_TIMEOUT_MS = 3_500
const SOURCE_RESULT_LIMIT = 30
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
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

async function fetchText(url: string, options: SearchEngineOptions): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': `${options.preferredLanguage || 'en'}-${(options.region || 'us').toUpperCase()},${options.preferredLanguage || 'en'};q=0.8`,
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`Search fallback returned HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function mergeResults(resultSets: ScrapedResult[][]): ScrapedResult[] {
  const seen = new Set<string>()
  const merged: ScrapedResult[] = []

  for (const result of resultSets.flat()) {
    try {
      const normalized = new URL(result.url).toString()
      if (!isUsableExternalResult(normalized, result.title, result.description)) continue
      if (seen.has(normalized)) continue
      seen.add(normalized)
      merged.push({ ...result, url: normalized, domain: result.domain || extractDomain(normalized) })
    } catch {
      // Ignore malformed result URLs from upstream search pages.
    }
  }

  return merged.slice(0, SOURCE_RESULT_LIMIT).map((result, index) => ({ ...result, rank: index + 1 }))
}

function toSearchPayload(results: ScrapedResult[]) {
  return {
    results,
    text: results.flatMap(result => [result.title, result.description, result.url]).join(' '),
  }
}

async function searchBingRss(query: string, options: SearchEngineOptions) {
  const url = new URL('https://www.bing.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'rss')
  url.searchParams.set('count', '20')
  url.searchParams.set('adlt', options.safeSearch === false ? 'off' : 'strict')
  if (options.preferredLanguage) url.searchParams.set('setlang', options.preferredLanguage)

  return parseBingRss(await fetchText(url.toString(), options))
}

async function searchDuckDuckGoLite(query: string, options: SearchEngineOptions) {
  const url = new URL('https://lite.duckduckgo.com/lite/')
  url.searchParams.set('q', query)
  if (options.safeSearch !== false) url.searchParams.set('kp', '1')
  if (options.region) url.searchParams.set('kl', `${options.region}-${options.preferredLanguage || 'en'}`)

  return parseDuckDuckGoLite(await fetchText(url.toString(), options))
}

export async function searchBingResilient(query: string, options: SearchEngineOptions = {}) {
  const settled = await Promise.allSettled([
    searchBingRss(query, options),
    withTimeout(searchBingHTML(query, options), FALLBACK_TIMEOUT_MS, 'Bing HTML search').then(result => result.results),
  ])
  const results = mergeResults(settled.flatMap(item => item.status === 'fulfilled' ? [item.value] : []))

  if (results.length === 0) throw new Error('Bing returned no parseable external results')
  return toSearchPayload(results)
}

export async function searchDuckDuckGoResilient(query: string, options: SearchEngineOptions = {}) {
  const settled = await Promise.allSettled([
    searchDuckDuckGoLite(query, options),
    withTimeout(searchDuckDuckGo(query, options), FALLBACK_TIMEOUT_MS, 'DuckDuckGo HTML search').then(result => result.results),
  ])
  const results = mergeResults(settled.flatMap(item => item.status === 'fulfilled' ? [item.value] : []))

  if (results.length === 0) throw new Error('DuckDuckGo returned no parseable external results')
  return toSearchPayload(results)
}
