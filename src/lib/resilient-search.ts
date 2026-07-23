import * as cheerio from 'cheerio'
import { searchBingHTML, searchDuckDuckGo, type SearchEngineOptions } from './search'
import type { ScrapedResult } from '../types/search'

const FALLBACK_TIMEOUT_MS = 4_500
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

function normalizeDuckDuckGoUrl(href: string): string | null {
  try {
    const absolute = new URL(href, 'https://lite.duckduckgo.com').toString()
    const parsed = new URL(absolute)
    const redirected = parsed.searchParams.get('uddg')
    const candidate = redirected || absolute
    const target = new URL(candidate)

    if (!['http:', 'https:'].includes(target.protocol)) return null
    if (/^(?:lite\.)?duckduckgo\.com$/i.test(target.hostname)) return null
    return target.toString()
  } catch {
    return null
  }
}

function mergeResults(resultSets: ScrapedResult[][]): ScrapedResult[] {
  const seen = new Set<string>()
  const merged: ScrapedResult[] = []

  for (const result of resultSets.flat()) {
    try {
      const normalized = new URL(result.url).toString()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      merged.push({ ...result, url: normalized, domain: result.domain || extractDomain(normalized) })
    } catch {
      // Ignore malformed result URLs from upstream search pages.
    }
  }

  return merged.slice(0, 30).map((result, index) => ({ ...result, rank: index + 1 }))
}

function toSearchPayload(results: ScrapedResult[]) {
  return {
    results,
    text: results.flatMap(result => [result.title, result.description, result.url]).join(' '),
  }
}

export function parseBingRss(xml: string): ScrapedResult[] {
  const $ = cheerio.load(xml, { xmlMode: true })
  const results: ScrapedResult[] = []

  $('item').each((_, element) => {
    const title = $(element).find('title').first().text().trim()
    const url = $(element).find('link').first().text().trim()
    const description = $(element).find('description').first().text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    if (!title || !/^https?:\/\//i.test(url)) return
    results.push({
      title,
      url,
      description,
      domain: extractDomain(url),
      source: 'Bing',
      rank: results.length + 1,
      score: 0,
    })
  })

  return results
}

export function parseDuckDuckGoLite(html: string): ScrapedResult[] {
  const $ = cheerio.load(html)
  const results: ScrapedResult[] = []
  const snippets = $('.result-snippet, .result__snippet').map((_, element) => $(element).text().replace(/\s+/g, ' ').trim()).get()

  $('a.result-link, a.result__a, td.result-link a').each((index, element) => {
    const title = $(element).text().replace(/\s+/g, ' ').trim()
    const href = $(element).attr('href') || ''
    const url = normalizeDuckDuckGoUrl(href)

    if (!title || !url) return
    results.push({
      title,
      url,
      description: snippets[index] || '',
      domain: extractDomain(url),
      source: 'DuckDuckGo',
      rank: results.length + 1,
      score: 0,
    })
  })

  return results
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

  if (results.length === 0) throw new Error('Bing returned no parseable results')
  return toSearchPayload(results)
}

export async function searchDuckDuckGoResilient(query: string, options: SearchEngineOptions = {}) {
  const settled = await Promise.allSettled([
    searchDuckDuckGoLite(query, options),
    withTimeout(searchDuckDuckGo(query, options), FALLBACK_TIMEOUT_MS, 'DuckDuckGo HTML search').then(result => result.results),
  ])
  const results = mergeResults(settled.flatMap(item => item.status === 'fulfilled' ? [item.value] : []))

  if (results.length === 0) throw new Error('DuckDuckGo returned no parseable results')
  return toSearchPayload(results)
}
