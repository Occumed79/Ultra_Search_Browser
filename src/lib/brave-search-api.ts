import type { ScrapedResult } from '../types/search'

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_TIMEOUT_MS = 8_000

interface BraveWebResult {
  title?: unknown
  url?: unknown
  description?: unknown
  extra_snippets?: unknown
}

interface BraveEnvelope {
  web?: {
    results?: unknown
  } | null
  message?: unknown
  detail?: unknown
}

export interface BraveApiSearchDiagnostics {
  configured: boolean
  attempted: boolean
  successful: boolean
  resultCount: number
  runtimeMs: number
  error?: string
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function snippets(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
      .map(item => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 3)
    : []
}

function normalizeResults(payload: BraveEnvelope, query: string, limit: number): ScrapedResult[] {
  const raw = Array.isArray(payload.web?.results)
    ? payload.web?.results as BraveWebResult[]
    : []
  const seen = new Set<string>()
  const results: ScrapedResult[] = []

  for (const item of raw) {
    const title = stringValue(item.title)
    const rawUrl = stringValue(item.url)
    if (!title || !rawUrl) continue

    try {
      const parsed = new URL(rawUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue
      parsed.hash = ''
      const url = parsed.toString().replace(/\/$/, '')
      const key = url.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const description = [
        stringValue(item.description),
        ...snippets(item.extra_snippets),
      ].filter(Boolean).join(' · ').slice(0, 1_500)

      results.push({
        title,
        url,
        description,
        domain: parsed.hostname.replace(/^www\./, ''),
        source: 'Brave Search API',
        rank: results.length + 1,
        score: 75,
        retrieval: {
          sources: ['Brave Search API'],
          queries: [query],
          purposes: ['managed-api-discovery'],
          overlap: 1,
        },
      })
      if (results.length >= limit) break
    } catch {
      // Ignore malformed result URLs while retaining valid search results.
    }
  }

  return results
}

export function braveApiSearchConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    environment.BRAVE_API_KEY?.trim()
    || environment.BRAVE_SEARCH_API_KEY?.trim()
  )
}

export async function searchBraveApi(
  query: string,
  limit = 15,
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ results: ScrapedResult[]; diagnostics: BraveApiSearchDiagnostics }> {
  const startedAt = Date.now()
  const apiKey = environment.BRAVE_API_KEY?.trim()
    || environment.BRAVE_SEARCH_API_KEY?.trim()
  if (!apiKey) {
    return {
      results: [],
      diagnostics: {
        configured: false,
        attempted: false,
        successful: false,
        resultCount: 0,
        runtimeMs: Date.now() - startedAt,
      },
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BRAVE_TIMEOUT_MS)
  try {
    const params = new URLSearchParams({
      q: query.slice(0, 400),
      count: String(Math.max(5, Math.min(20, limit))),
      country: 'US',
      search_lang: 'en',
      safesearch: 'moderate',
      extra_snippets: 'true',
    })
    const response = await fetchImpl(`${BRAVE_SEARCH_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    const text = await response.text()
    let payload: BraveEnvelope = {}
    try {
      payload = text ? JSON.parse(text) as BraveEnvelope : {}
    } catch {
      throw new Error('Brave Search API returned malformed JSON')
    }

    if (!response.ok) {
      const detail = stringValue(payload.detail) || stringValue(payload.message)
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 220)}` : ''}`)
    }

    const results = normalizeResults(payload, query, limit)
    return {
      results,
      diagnostics: {
        configured: true,
        attempted: true,
        successful: results.length > 0,
        resultCount: results.length,
        runtimeMs: Date.now() - startedAt,
        ...(results.length === 0 ? { error: 'Brave Search API returned no usable web results' } : {}),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      results: [],
      diagnostics: {
        configured: true,
        attempted: true,
        successful: false,
        resultCount: 0,
        runtimeMs: Date.now() - startedAt,
        error: message.slice(0, 400),
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
