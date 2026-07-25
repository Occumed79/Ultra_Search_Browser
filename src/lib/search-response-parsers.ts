import * as cheerio from 'cheerio'
import type { ScrapedResult } from '../types/search'

const SEARCH_ENGINE_HOSTS = new Set([
  'bing.com',
  'www.bing.com',
  'google.com',
  'www.google.com',
  'duckduckgo.com',
  'html.duckduckgo.com',
  'lite.duckduckgo.com',
  'search.yahoo.com',
])

const AUTHENTICATION_HOSTS = new Set([
  'login.live.com',
  'signup.live.com',
  'account.microsoft.com',
  'login.microsoftonline.com',
  'accounts.google.com',
  'appleid.apple.com',
])

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function isUsableExternalResult(
  url: string,
  title = '',
  description = ''
): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const text = `${title} ${description}`.toLowerCase().replace(/\s+/g, ' ')

    if (SEARCH_ENGINE_HOSTS.has(host)) return false
    if (AUTHENTICATION_HOSTS.has(host)) return false
    if (/\b(?:create|register|sign\s*up)\s+(?:a\s+|your\s+)?(?:new\s+)?account\b/.test(text)) return false
    if (/\b(?:sign|log)\s*in\b/.test(text) && /\/(?:login|signin|sign-in|account|oauth|authorize|auth)(?:\/|$)/.test(path)) return false
    if (/\/(?:oauth|authorize|sso)(?:\/|$)/.test(path)) return false
    return true
  } catch {
    return false
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
    if (/^(?:lite\.|html\.)?duckduckgo\.com$/i.test(target.hostname)) return null
    return target.toString()
  } catch {
    return null
  }
}

export function parseBingRss(xml: string): ScrapedResult[] {
  const $ = cheerio.load(xml, { xmlMode: true })
  const results: ScrapedResult[] = []

  $('item').each((_, element) => {
    const title = $(element).find('title').first().text().trim()
    const url = $(element).find('link').first().text().trim()
    const description = $(element)
      .find('description')
      .first()
      .text()
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!title || !isUsableExternalResult(url, title, description)) return
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
  const snippets = $('.result-snippet, .result__snippet')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get()

  $('a.result-link, a.result__a, td.result-link a').each((index, element) => {
    const title = $(element).text().replace(/\s+/g, ' ').trim()
    const href = $(element).attr('href') || ''
    const url = normalizeDuckDuckGoUrl(href)
    const description = snippets[index] || ''

    if (!title || !url || !isUsableExternalResult(url, title, description)) return
    results.push({
      title,
      url,
      description,
      domain: extractDomain(url),
      source: 'DuckDuckGo',
      rank: results.length + 1,
      score: 0,
    })
  })

  return results
}
