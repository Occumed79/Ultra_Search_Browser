// ─── MARGINALIA API INTEGRATION ───
// Niche non-commercial content booster

import type { ScrapedResult } from '../types/search'

const MARGINALIA_API_URL = process.env.MARGINALIA_API_URL || 'https://search.marginalia.nu'

export interface MarginaliaResult {
  title: string
  url: string
  description: string
  domain: string
  weight: number
}

/**
 * Search using Marginalia API
 */
export async function searchMarginalia(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  try {
    const url = new URL(MARGINALIA_API_URL)
    url.searchParams.set('query', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('count', '20')

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'UltraSearchBrowser/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`Marginalia error: ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.results || !Array.isArray(data.results)) {
      return { text: '', results: [] }
    }

    const results = data.results.map((result: MarginaliaResult, index: number) => ({
      url: result.url,
      title: result.title,
      description: result.description,
      source: 'marginalia',
      rank: index + 1,
    }))

    const text = results.map((r: ScrapedResult) => `${r.title} ${r.description}`).join(' ')
    return { text, results }
  } catch (error) {
    console.warn('Marginalia search failed:', error)
    return { text: '', results: [] }
  }
}

/**
 * Check if Marginalia API is available
 */
export async function checkMarginaliaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${MARGINALIA_API_URL}/api/v1/alive`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
