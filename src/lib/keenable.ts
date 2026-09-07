import type { ScrapedResult } from '../types/search'
import { providerKeyCount, rotatingProviderKeys } from './provider-key-pool'

const DEFAULT_ENDPOINT = 'https://api.keenable.ai/v1/search'
const DEFAULT_PUBLIC_ENDPOINT = 'https://api.keenable.ai/v1/search/public'
const DEFAULT_TIMEOUT_MS = 12_000
const KEENABLE_KEYS = [
  'KEENABLE_API_KEY',
  'KEENABLE_API_KEY_2',
  'KEENABLE_API_KEY_3',
  'KEENABLE_API_KEY_4',
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

function validatedEndpoint(rawValue: string, fallback: string): string {
  const raw = String(rawValue || fallback).trim()
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback
    if (!parsed.hostname || parsed.username || parsed.password) return fallback
    return parsed.toString()
  } catch {
    return fallback
  }
}

function endpoint(): string {
  return validatedEndpoint(process.env.KEENABLE_API_BASE_URL || DEFAULT_ENDPOINT, DEFAULT_ENDPOINT)
}

function publicEndpoint(): string {
  const configured = String(process.env.KEENABLE_API_BASE_URL || '').trim()
  if (!configured) return DEFAULT_PUBLIC_ENDPOINT

  const authenticated = validatedEndpoint(configured, DEFAULT_ENDPOINT)
  try {
    const parsed = new URL(authenticated)
    if (/\/v1\/search\/public\/?$/i.test(parsed.pathname)) return parsed.toString()
    if (/\/v1\/search\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/public`
      return parsed.toString()
    }
  } catch {
    // Fall through to the known public endpoint.
  }
  return DEFAULT_PUBLIC_ENDPOINT
}

function publicSearchEnabled(): boolean {
  return String(process.env.KEENABLE_PUBLIC_SEARCH || 'true').trim().toLowerCase() !== 'false'
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

function normalizedResults(payload: KeenableApiResponse, maxResults: number): ScrapedResult[] {
  return (Array.isArray(payload.results) ? payload.results : [])
    .map((row, index) => normalizeResult(row, index))
    .filter((result): result is ScrapedResult => result != null)
    .slice(0, maxResults)
    .map((result, index) => ({ ...result, rank: index + 1 }))
}

function success(results: ScrapedResult[], keyCount: number): KeenableSearchResponse {
  return {
    text: results.map(result => `${result.title} ${result.description}`).join(' '),
    results,
    configured: true,
    ok: true,
    keyCount,
  }
}

export function keenableKeyCount(): number {
  return providerKeyCount(KEENABLE_KEYS)
}

/**
 * Keenable is available even without credentials through its public keyless
 * endpoint. A configured key pool raises rate limits but is not required.
 */
export function isKeenableConfigured(): boolean {
  return keenableKeyCount() > 0 || publicSearchEnabled()
}

export async function searchKeenable(
  query: string,
  options: KeenableSearchOptions = {}
): Promise<KeenableSearchResponse> {
  const keys = rotatingProviderKeys('keenable', KEENABLE_KEYS, KEENABLE_KEYS.length)
  const keyCount = keenableKeyCount()
  const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!normalizedQuery) {
    return {
      text: '',
      results: [],
      configured: isKeenableConfigured(),
      ok: false,
      keyCount,
      error: 'Keenable query is empty.',
    }
  }

  if (keys.length === 0 && !publicSearchEnabled()) {
    return {
      text: '',
      results: [],
      configured: false,
      ok: false,
      keyCount: 0,
      error: 'Keenable public search is disabled and no KEENABLE_API_KEY values are configured.',
    }
  }

  const timeoutMs = positiveInteger(options.timeoutMs || process.env.KEENABLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const maxResults = Math.max(1, Math.min(50, positiveInteger(options.maxResults, 20)))
  const mode = String(options.mode || process.env.KEENABLE_SEARCH_MODE || 'pro').trim() || 'pro'
  const body = JSON.stringify({ query: normalizedQuery, mode })
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
        body,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => null) as KeenableApiResponse | null
      if (!response.ok) {
        const detail = String(payload?.message || payload?.error || '').trim()
        lastError = detail
          ? `Keenable returned HTTP ${response.status}: ${detail.slice(0, 300)}`
          : `Keenable returned HTTP ${response.status}.`
        continue
      }

      if (!payload || !Array.isArray(payload.results)) {
        lastError = 'Keenable returned an invalid result payload.'
        continue
      }

      return success(normalizedResults(payload, maxResults), keyCount)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  if (publicSearchEnabled()) {
    try {
      const response = await fetch(publicEndpoint(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Keenable-Title': 'Ultra Search Browser',
          'User-Agent': 'UltraSearchBrowser/2.0',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => null) as KeenableApiResponse | null
      if (!response.ok) {
        const detail = String(payload?.message || payload?.error || '').trim()
        lastError = detail
          ? `Keenable public search returned HTTP ${response.status}: ${detail.slice(0, 300)}`
          : `Keenable public search returned HTTP ${response.status}.`
      } else if (!payload || !Array.isArray(payload.results)) {
        lastError = 'Keenable public search returned an invalid result payload.'
      } else {
        return success(normalizedResults(payload, maxResults), keyCount)
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    text: '',
    results: [],
    configured: isKeenableConfigured(),
    ok: false,
    keyCount,
    error: lastError,
  }
}