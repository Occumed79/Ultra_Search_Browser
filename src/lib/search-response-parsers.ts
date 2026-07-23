import * as cheerio from 'cheerio'
import type { ScrapedResult } from '../types/search'

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
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
  const snippets = $('.result-snippet, .result__snippet')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get()

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
