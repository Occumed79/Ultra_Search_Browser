import * as cheerio from 'cheerio'
import { isUsableExternalResult } from './search-response-parsers'
import type { ScrapedResult } from '../types/search'

export interface PublicSearchOptions {
  safeSearch?: boolean
  preferredLanguage?: string
  region?: string
}

const SEARCH_TIMEOUT_MS = 5_500
const RESULT_LIMIT = 20
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function fetchSearchPage(url: URL, options: PublicSearchOptions): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7',
        'Accept-Language': `${options.preferredLanguage || 'en'}-${(options.region || 'us').toUpperCase()},${options.preferredLanguage || 'en'};q=0.8`,
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function normalizeYahooUrl(href: string): string | undefined {
  try {
    const absolute = new URL(href, 'https://search.yahoo.com').toString()
    const parsed = new URL(absolute)
    if (parsed.hostname === 'r.search.yahoo.com') {
      const encoded = parsed.pathname.match(/\/RU=([^/]+)/)?.[1]
      if (!encoded) return undefined
      return decodeURIComponent(encoded)
    }
    return absolute
  } catch {
    return undefined
  }
}

function pushResult(
  results: ScrapedResult[],
  seen: Set<string>,
  source: string,
  title: string,
  rawUrl: string | undefined,
  description: string,
  normalizeUrl: (href: string) => string | undefined = href => href
) {
  if (!rawUrl || results.length >= RESULT_LIMIT) return
  const url = normalizeUrl(rawUrl)
  if (!url || seen.has(url)) return
  if (!isUsableExternalResult(url, title, description)) return
  seen.add(url)
  results.push({
    title: clean(title),
    url,
    description: clean(description),
    domain: domainOf(url),
    source,
    rank: results.length + 1,
    score: 0,
  })
}

export function parseYahooSearchHtml(html: string): ScrapedResult[] {
  const $ = cheerio.load(html)
  const results: ScrapedResult[] = []
  const seen = new Set<string>()
  const cards = [
    '#web ol.searchCenterMiddle > li',
    'ol.searchCenterMiddle > li',
    'div.algo',
    'li div.dd.algo',
  ].join(', ')

  $(cards).each((_, element) => {
    const link = $(element).find('h3 a[href], a[href].ac-algo, a[href][data-ylk*="slk:title"]').first()
    pushResult(
      results,
      seen,
      'Yahoo',
      link.text(),
      link.attr('href'),
      $(element).find('.compText, .compText p, p').first().text(),
      normalizeYahooUrl
    )
  })
  return results
}

export function parseBraveSearchHtml(html: string): ScrapedResult[] {
  const $ = cheerio.load(html)
  const results: ScrapedResult[] = []
  const seen = new Set<string>()
  const cards = [
    'div.snippet[data-type="web"]',
    'div[data-testid="web-result"]',
    'div.result',
  ].join(', ')

  $(cards).each((_, element) => {
    const link = $(element).find('a.result-header[href], a[data-testid="result-title-a"][href], .title a[href], h2 a[href], h3 a[href]').first()
    pushResult(
      results,
      seen,
      'Brave',
      link.text() || $(element).find('h2, h3').first().text(),
      link.attr('href'),
      $(element).find('.snippet-description, .description, .snippet-content, p').first().text()
    )
  })
  return results
}

export function parseMojeekSearchHtml(html: string): ScrapedResult[] {
  const $ = cheerio.load(html)
  const results: ScrapedResult[] = []
  const seen = new Set<string>()

  $('.results-standard .result, li.result, div.result').each((_, element) => {
    const link = $(element).find('h2 a[href], h3 a[href], a.title[href]').first()
    pushResult(
      results,
      seen,
      'Mojeek',
      link.text(),
      link.attr('href'),
      $(element).find('.s, .desc, .description, p').first().text()
    )
  })
  return results
}

function response(results: ScrapedResult[]) {
  return {
    results,
    text: results.flatMap(result => [result.title, result.description, result.url]).join(' '),
  }
}

export async function searchYahooHtml(query: string, options: PublicSearchOptions = {}) {
  const url = new URL('https://search.yahoo.com/search')
  url.searchParams.set('p', query)
  url.searchParams.set('n', '20')
  if (options.preferredLanguage) url.searchParams.set('vl', options.preferredLanguage)
  return response(parseYahooSearchHtml(await fetchSearchPage(url, options)))
}

export async function searchBraveHtml(query: string, options: PublicSearchOptions = {}) {
  const url = new URL('https://search.brave.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('source', 'web')
  if (options.safeSearch !== false) url.searchParams.set('safesearch', 'strict')
  return response(parseBraveSearchHtml(await fetchSearchPage(url, options)))
}

export async function searchMojeekHtml(query: string, options: PublicSearchOptions = {}) {
  const url = new URL('https://www.mojeek.com/search')
  url.searchParams.set('q', query)
  if (options.safeSearch !== false) url.searchParams.set('safe', '1')
  return response(parseMojeekSearchHtml(await fetchSearchPage(url, options)))
}
