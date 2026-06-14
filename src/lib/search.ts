import * as cheerio from 'cheerio'
import {
  type IntelligenceObject,
  type ExpandedQuery,
  type SearchLens,
  expandQuery,
  scoreSignals,
  calculateConfidence,
  buildIntelligenceObject,
  LENS_CONFIGS,
} from './intelligence'
import { extractIntelligence } from './entity-extraction'
import type { ScrapedResult } from '../types/search'

// Re-export intelligence types for consumers
export type { IntelligenceObject, ExpandedQuery, SearchLens }
export type { ScrapedResult }


export function extractWebsites(text: string, domainHint?: string): string[] {
  const urlRegex = /https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=]*)?/g
  const urls = [...text.matchAll(urlRegex)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i)
  if (domainHint) {
    return urls.filter(u => u.toLowerCase().includes(domainHint.toLowerCase()))
  }
  return urls
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// --- Scraping-based search (no API keys) ---

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchWithTimeout(url: string, timeout = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res
  } catch {
    clearTimeout(timer)
    throw new Error(`Fetch timeout for ${url}`)
  }
}

export async function searchDuckDuckGo(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetchWithTimeout(searchUrl)
  if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const results: ScrapedResult[] = []
  const snippets: string[] = []

  $('.result').each((_, el) => {
    const title = $(el).find('.result__a').first().text().trim()
    const href = $(el).find('.result__a').first().attr('href') || ''
    const desc = $(el).find('.result__snippet').first().text().trim()

    if (title && href) {
      const url = href.startsWith('http') ? href : `https:${href}`
      results.push({ title, url, description: desc, domain: extractDomain(url), source: 'DuckDuckGo', rank: results.length + 1, score: 0 })
      snippets.push(title, desc, url)
    }
  })

  return { text: snippets.join(' '), results }
}

export async function searchBingHTML(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`
  const res = await fetchWithTimeout(searchUrl)
  if (!res.ok) throw new Error(`Bing error: ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const results: ScrapedResult[] = []
  const snippets: string[] = []

  $('li.b_algo').each((_, el) => {
    const title = $(el).find('h2 a').first().text().trim()
    let href = $(el).find('h2 a').first().attr('href') || ''
    const desc = $(el).find('.b_caption p').first().text().trim()

    if (title && href) {
      if (!href.startsWith('http')) href = `https://www.bing.com${href}`
      results.push({ title, url: href, description: desc, domain: extractDomain(href), source: 'Bing', rank: results.length + 1, score: 0 })
      snippets.push(title, desc, href)
    }
  })

  return { text: snippets.join(' '), results }
}

function cleanGoogleUrl(href: string): string {
  if (href.startsWith('/url?q=')) {
    const match = href.match(/\/url\?q=([^&]+)/)
    if (match) return decodeURIComponent(match[1])
  }
  if (href.startsWith('http')) return href
  return `https://www.google.com${href}`
}

export async function searchGoogleScrape(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`
  const res = await fetchWithTimeout(searchUrl)
  if (!res.ok) throw new Error(`Google error: ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const results: ScrapedResult[] = []
  const snippets: string[] = []
  const seenUrls = new Set<string>()

  const selectors = ['.g', 'div[data-sokoban-container]']

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const title = $(el).find('h3').first().text().trim() || $(el).find('a[href^="/url"]').first().text().trim()
      let href = $(el).find('a[href^="/url"]').first().attr('href') || ''
      const desc = $(el).find('.VwiC3b').first().text().trim() || $(el).find('span').eq(2).text().trim()

      if (title && href) {
        const url = cleanGoogleUrl(href)
        if (url && !seenUrls.has(url) && url.startsWith('http')) {
          seenUrls.add(url)
          results.push({ title, url, description: desc, domain: extractDomain(url), source: 'Google', rank: results.length + 1, score: 0 })
          snippets.push(title, desc, url)
        }
      }
    })
    if (results.length > 0) break
  }

  return { text: snippets.join(' '), results }
}

export async function scrapeWebsite(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(url, 5000)
    if (!res.ok) return ''
    const html = await res.text()
    const $ = cheerio.load(html)
    // Remove script/style for cleaner text
    $('script, style, nav, header, footer').remove()
    return $('body').text().replace(/\s+/g, ' ')
  } catch {
    return ''
  }
}

export async function searchAllEngines(
  queries: string[]
): Promise<{ text: string; sources: string[]; rawTexts: string[]; results: ScrapedResult[] }> {
  const texts: string[] = []
  const sources: string[] = []
  const rawTexts: string[] = []
  const allResults: ScrapedResult[] = []
  const seenUrls = new Set<string>()

  const engines = [
    { name: 'DuckDuckGo', fn: searchDuckDuckGo },
    { name: 'Bing', fn: searchBingHTML },
    { name: 'Google', fn: searchGoogleScrape },
  ]

  for (const query of queries) {
    for (const engine of engines) {
      try {
        const data = await engine.fn(query)
        if (data.text.trim().length > 50) {
          texts.push(data.text)
          rawTexts.push(data.text)
          sources.push(`${engine.name} (${query.slice(0, 40)})`)
        }
        for (const r of data.results) {
          if (r.url && !seenUrls.has(r.url) && r.title) {
            seenUrls.add(r.url)
            allResults.push(r)
          }
        }
      } catch (err) {
        console.warn(`${engine.name} failed for "${query}":`, err)
      }
    }
  }

  // Also try scraping the top website found
  const allText = texts.join(' ')
  const foundUrls = extractWebsites(allText)
  if (foundUrls.length > 0) {
    try {
      const siteText = await scrapeWebsite(foundUrls[0])
      if (siteText.length > 100) {
        texts.push(siteText)
        rawTexts.push(siteText)
        sources.push(`Direct: ${new URL(foundUrls[0]).hostname}`)
      }
    } catch {
      // ignore
    }
  }

  // Rank results by source diversity and deduplicate
  allResults.forEach((r, i) => { r.rank = i + 1 })

  return { text: texts.join(' '), sources, rawTexts, results: allResults }
}


// ─── INTELLIGENCE-POWERED SEARCH ───

export async function searchIntelligence(
  query: string,
  forcedLens?: SearchLens
): Promise<{ intelligence: IntelligenceObject; results: ScrapedResult[] }> {
  const expanded = expandQuery(query, forcedLens)
  const lens = expanded.lens

  const allQueries = [
    query,
    ...expanded.expansions.slice(0, 6),
    ...expanded.withOperators.slice(0, 3),
  ]

  const { text, sources, rawTexts, results } = await searchAllEngines(allQueries)

  // Enrich results with intelligence objects for relevant lenses
  const enrichedResults = await Promise.all(
    results.map(async (result) => {
      if (['procurement', 'provider', 'pricing'].includes(lens)) {
        try {
          const content = await scrapeWebsite(result.url)
          if (content.length > 100) {
            const intelligence = extractIntelligence(content, result.url, result.title, lens)
            if (intelligence) {
              return { ...result, intelligence }
            }
          }
        } catch {
          // If scraping fails, return result without intelligence
        }
      }
      return result
    })
  )

  if (text.trim().length < 100) {
    const intelligence = buildIntelligenceObject(query, expanded, sources, rawTexts, 'Limited results from search engines')
    return { intelligence, results: enrichedResults }
  }

  const intelligence = buildIntelligenceObject(query, expanded, sources, rawTexts)
  return { intelligence, results: enrichedResults }
}

