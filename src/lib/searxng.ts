// ─── SEARXNG INTEGRATION ───
// Self-hosted metasearch — always-on parallel source when SEARXNG_URL is set

import type { ScrapedResult } from '../types/search'

export interface SearXNGResult {
  title: string
  url: string
  content: string
  engine: string
  score: number
  category: string
}

/**
 * Resolve and validate SEARXNG_URL. Returns null if unset or unsafe.
 * Does not default to localhost (that would make "always on" hit a dead endpoint).
 */
export function resolveSearxngBase(): string | null {
  const raw = process.env.SEARXNG_URL?.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password) return null
    const host = u.hostname.toLowerCase()
    if (!host) return null
    // Allow localhost only when explicitly configured (self-host dev)
    if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(host) && host !== '127.0.0.1' && host !== 'localhost') {
      // private LAN OK if user set SEARXNG_URL intentionally
    }
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

export function isSearxngConfigured(): boolean {
  return resolveSearxngBase() !== null
}

/**
 * Search using SearXNG instance. No-ops cleanly when SEARXNG_URL is unset.
 */
export async function searchSearXNG(
  query: string,
  options: { safeSearch?: boolean; preferredLanguage?: string; region?: string } = {}
): Promise<{ text: string; results: ScrapedResult[] }> {
  const base = resolveSearxngBase()
  if (!base) {
    return { text: '', results: [] }
  }

  try {
    const url = new URL(`${base}/search`)
    url.searchParams.set('q', query.slice(0, 240))
    url.searchParams.set('format', 'json')
    url.searchParams.set('engines', 'google,bing,duckduckgo,brave')
    url.searchParams.set('safesearch', options.safeSearch === false ? '0' : '2')
    if (options.preferredLanguage) url.searchParams.set('language', options.preferredLanguage)

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'UltraSearchBrowser/1.0',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`SearXNG error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.results || !Array.isArray(data.results)) {
      return { text: '', results: [] }
    }

    const results = data.results
      .slice(0, 20)
      .map((result: SearXNGResult, index: number) => {
        let domain = ''
        try {
          domain = new URL(result.url).hostname.replace(/^www\./, '')
        } catch {
          return null
        }
        if (!result.url || !result.title) return null
        return {
          url: result.url,
          title: String(result.title).slice(0, 200),
          description: String(result.content || '').slice(0, 500),
          domain,
          source: 'SearXNG',
          rank: index + 1,
          score: Number.isFinite(result.score) ? result.score : 0,
        } satisfies ScrapedResult
      })
      .filter((r: ScrapedResult | null): r is ScrapedResult => r != null)

    const text = results.map((r: ScrapedResult) => `${r.title} ${r.description}`).join(' ')
    return { text, results }
  } catch (error) {
    console.warn('SearXNG search failed:', error)
    return { text: '', results: [] }
  }
}

/**
 * Check if SearXNG is configured and reachable.
 */
export async function checkSearXNGAvailable(): Promise<boolean> {
  const base = resolveSearxngBase()
  if (!base) return false
  try {
    const response = await fetch(`${base}/config`, {
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}
