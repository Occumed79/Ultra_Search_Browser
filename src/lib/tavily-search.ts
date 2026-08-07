import type { ScrapedResult } from '../types/search'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
const TAVILY_TIMEOUT_MS = 8_000
const TAVILY_ENV_KEYS = [
  'TAVILY_API_KEY',
  'TAVILY_KEY',
  'TAVILY_API',
  'TAVILY_SEARCH_API_KEY',
  'TAVILY_TOKEN',
] as const

interface TavilySearchResult {
  title?: unknown
  url?: unknown
  content?: unknown
  score?: unknown
}

interface TavilySearchEnvelope {
  results?: unknown
  response_time?: unknown
  request_id?: unknown
  detail?: unknown
  error?: unknown
  message?: unknown
}

export interface TavilySearchDiagnostics {
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

function resultArray(value: unknown): TavilySearchResult[] {
  return Array.isArray(value)
    ? value.filter((item): item is TavilySearchResult => Boolean(item && typeof item === 'object'))
    : []
}

function normalizeResults(payload: TavilySearchEnvelope, query: string, limit: number): ScrapedResult[] {
  const seen = new Set<string>()
  const results: ScrapedResult[] = []

  for (const item of resultArray(payload.results)) {
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

      results.push({
        title,
        url,
        description: stringValue(item.content).slice(0, 1_200),
        domain: parsed.hostname.replace(/^www\./, ''),
        source: 'Tavily Search',
        rank: results.length + 1,
        score: typeof item.score === 'number' && Number.isFinite(item.score)
          ? Math.max(0, Math.min(100, item.score * 100))
          : 0,
        retrieval: {
          sources: ['Tavily Search'],
          queries: [query],
          purposes: ['managed-api-discovery'],
          overlap: 1,
        },
      })
      if (results.length >= limit) break
    } catch {
      // Ignore malformed result URLs while preserving valid Tavily results.
    }
  }

  return results
}

function tavilyApiKey(environment: NodeJS.ProcessEnv): string {
  for (const name of TAVILY_ENV_KEYS) {
    const value = environment[name]?.trim()
    if (value) return value
  }
  const inferred = Object.entries(environment).find(([name, value]) =>
    name.toUpperCase().startsWith('TAVILY_')
    && /(?:^|_)(?:KEY|TOKEN)(?:_|$)/.test(name.toUpperCase())
    && Boolean(value?.trim())
  )
  return inferred?.[1]?.trim() || ''
}

export function tavilySearchConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(tavilyApiKey(environment))
}

export async function searchTavilyWeb(
  query: string,
  limit = 15,
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ results: ScrapedResult[]; diagnostics: TavilySearchDiagnostics }> {
  const startedAt = Date.now()
  const apiKey = tavilyApiKey(environment)
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
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS)
  try {
    const response = await fetchImpl(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: Math.max(5, Math.min(20, limit)),
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        topic: 'general',
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    const text = await response.text()
    let payload: TavilySearchEnvelope = {}
    try {
      payload = text ? JSON.parse(text) as TavilySearchEnvelope : {}
    } catch {
      throw new Error('Tavily returned malformed JSON')
    }

    if (!response.ok) {
      const message = stringValue(payload.detail)
        || stringValue(payload.error)
        || stringValue(payload.message)
      throw new Error(`HTTP ${response.status}${message ? `: ${message.slice(0, 220)}` : ''}`)
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
        ...(results.length === 0 ? { error: 'Tavily returned no usable links' } : {}),
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
