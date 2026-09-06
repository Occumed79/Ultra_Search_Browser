import type { ScrapedResult } from '../types/search'
import { providerKeyCount, rotatingProviderKeys } from './provider-key-pool'

const DEFAULT_ENDPOINT = 'https://api.keenable.ai/v1/search'
const DEFAULT_TIMEOUT_MS = 12_000
const KEENABLE_KEYS = [
  'KEENABLE_API_KEY',
  'KEENABLE_API_KEY_2',
  'KEENABLE_API_KEY_3',
]

interface KeenableApiResult {
  title?: unknown
  url?: unknown
  description?: unknown
  snippet?: unknown
  published_at?: unknown
  acquired_at?: unknown
}

interface KeenableApiResponse {
  results?: KeenableApiResult[]
  error?: unknown
  message?: unknown
}

export interface KeenableSearchOptions {
  maxResults?: number
  timeoutMs?: number
  mode?: string
}

export interface KeenableSearchResponse {
  text: string
  results: ScrapedResult[]
  configured: boolean
  ok: boolean
  keyCount?: number
  error?: string
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function endpoint(): string {
  const raw = String(process.env.KEENABLE_API_BASE_URL || DEFAULT_ENDPOINT).trim()
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_ENDPOINT
    if (!parsed.hostname || parsed.username || parsed.password) return DEFAULT_ENDPOINT
    return parsed.toString()
  } catch {
    return DEFAULT_ENDPOINT
  }
}

function normalizeHttpUrl(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function normalizeResult(row: KeenableApiResult, index: number): ScrapedResult | null {
  const title = String(row.title || '').replace(/\s+/g, ' ').trim()
  const url = normalizeHttpUrl(row.url)
  if (!title || !url) return null

  const parsed = new URL(url)
  const description = String(row.snippet || row.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000)

  return {
    title: title.slice(0, 500),
    url,
    description,
    domain: parsed.hostname.replace(/^www\./, '').toLowerCase(),
    source: 'Keenable',
    rank: index + 1,
    score: Math.max(10, 100 - index * 2),
  }
}

export function keenableKeyCount(): number {
  return providerKeyCount(KEENABLE_KEYS)
}

export function isKeenableConfigured(): boolean {
  return keenableKeyCount() > 0
}

export async function searchKeenable(
  query: string,
  options: KeenableSearchOptions = {}
): Promise<KeenableSearchResponse> {
  const keys = rotatingProviderKeys('keenable', KEENABLE_KEYS, 2)
  const keyCount = keenableKeyCount()
  if (keys.length === 0) {
    return {
      text: '',
      results: [],
      configured: false,
      ok: false,
      keyCount: 0,
      error: 'No KEENABLE_API_KEY values are configured.',
    }
  }

  const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!normalizedQuery) {
    return {
      text: '',
      results: [],
      configured: true,
      ok: false,
      keyCount,
      error: 'Keenable query is empty.',
    }
  }

  const timeoutMs = positiveInteger(options.timeoutMs || process.env.KEENABLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const maxResults = Math.max(1, Math.min(50, positiveInteger(options.maxResults, 20)))
  const mode = String(options.mode || process.env.KEENABLE_SEARCH_MODE || 'pro').trim() || 'pro'
  let lastError = 'Keenable search failed.'

  for (const slot of keys) {
    try {
      const response = await fetch(endpoint(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': slot.value,
          'X-Keenable-Title': 'Ultra Search Browser',
          'User-Agent': 'UltraSearchBrowser/2.0',
        },
        body: JSON.stringify({ query: normalizedQuery, mode }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => null) as KeenableApiResponse | null
      if (!response.ok) {
        const detail = String(payload?.message || payload?.error || '').trim()
        lastError = detail
          ? `Keenable returned HTTP ${response.status}: ${detail.slice(0, 300)}`
          : `Keenable returned HTTP ${response.status}.`
        if ([401, 402, 403, 429].includes(response.status)) continue
        return { text: '', results: [], configured: true, ok: false, keyCount, error: lastError }
      }

      if (!payload || !Array.isArray(payload.results)) {
        return {
          text: '',
          results: [],
          configured: true,
          ok: false,
          keyCount,
          error: 'Keenable returned an invalid result payload.',
        }
      }

      const results = payload.results
        .map((row, index) => normalizeResult(row, index))
        .filter((result): result is ScrapedResult => result != null)
        .slice(0, maxResults)
        .map((result, index) => ({ ...result, rank: index + 1 }))

      return {
        text: results.map(result => `${result.title} ${result.description}`).join(' '),
        results,
        configured: true,
        ok: true,
        keyCount,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    text: '',
    results: [],
    configured: true,
    ok: false,
    keyCount,
    error: lastError,
  }
}
