// ─── SEARXNG INTEGRATION ───
// Self-hosted metasearch backbone

import type { ScrapedResult } from '../types/search'

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8080'

export interface SearXNGResult {
  title: string
  url: string
  content: string
  engine: string
  score: number
  category: string
}

/**
 * Search using SearXNG instance
 */
export async function searchSearXNG(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  try {
    const url = new URL(`${SEARXNG_URL}/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('engines', 'google,bing,duckduckgo,brave') // Default engines

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`SearXNG error: ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.results || !Array.isArray(data.results)) {
      return { text: '', results: [] }
    }

    const results = data.results.map((result: SearXNGResult, index: number) => ({
      url: result.url,
      title: result.title,
      description: result.content,
      source: `searxng-${result.engine}`,
      rank: index + 1,
    }))

    const text = results.map((r: ScrapedResult) => `${r.title} ${r.description}`).join(' ')
    return { text, results }
  } catch (error) {
    console.warn('SearXNG search failed:', error)
    return { text: '', results: [] }
  }
}

/**
 * Check if SearXNG is configured and available
 */
export async function checkSearXNGAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${SEARXNG_URL}/config`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
