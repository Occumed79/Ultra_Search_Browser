import { parseBangs } from './bangs'
import { expandQuery } from './intelligence'
import { buildQueryVariants, type QueryPurpose } from './search-planner'
import { parseSearchOperators, type OperatorsResult } from './search-operators'
import {
  buildDeterministicSemanticIntent,
  coerceSemanticIntentPlan,
  type SemanticIntentPlan,
} from './semantic-intent'
import type { ScrapedResult } from '../types/search'

export interface BrowserSearchVariant {
  id: string
  query: string
  purpose: QueryPurpose
  priority: number
}

export interface BrowserSearchPlan {
  query: string
  lens: 'procurement'
  intent: SemanticIntentPlan
  searches: BrowserSearchVariant[]
  transport: 'searxng'
  apiKeysRequired: false
  maxResultsPerSearch: number
  timestamp: string
  traceId?: string
}

export interface BrowserSerpCandidateInput {
  title?: unknown
  url?: unknown
  description?: unknown
  source?: unknown
  rank?: unknown
  score?: unknown
  query?: unknown
  purpose?: unknown
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function reconstructQuery(operators: OperatorsResult, fallback: string): string {
  return [...operators.exactPhrases, operators.cleanQuery]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || fallback.trim()
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  try {
    return atob(padded)
  } catch {
    return null
  }
}

/**
 * Search engines sometimes return their own tracking/redirect URL instead of
 * the destination URL. Keeping the wrapper breaks domain/path classification,
 * dedupe, and destination validation. Resolve only well-known deterministic
 * wrapper shapes; if a recognized wrapper cannot yield a safe HTTP(S) target,
 * drop it rather than pretending the search-engine tracking URL is evidence.
 */
function unwrapSearchEngineRedirect(url: URL): URL | null {
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()

  if ((host === 'bing.com' || host.endsWith('.bing.com')) && path.startsWith('/ck/')) {
    const rawTarget = url.searchParams.get('u')?.trim() || ''
    if (!rawTarget) return null

    const direct = safeHttpUrl(rawTarget)
    if (direct) return direct

    // Bing commonly prefixes its base64url destination with the marker "a1".
    const encoded = rawTarget.startsWith('a1') ? rawTarget.slice(2) : rawTarget
    const decoded = decodeBase64Url(encoded)
    return decoded ? safeHttpUrl(decoded) : null
  }

  if ((host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) && (path === '/l/' || path === '/l')) {
    const target = url.searchParams.get('uddg')?.trim() || ''
    return target ? safeHttpUrl(target) : null
  }

  if ((host === 'google.com' || /(^|\.)google\.[a-z.]+$/i.test(host)) && path === '/url') {
    const target = (url.searchParams.get('url') || url.searchParams.get('q') || '').trim()
    return target ? safeHttpUrl(target) : null
  }

  return url
}

function cleanResultUrl(value: string): string | null {
  try {
    let url = safeHttpUrl(value)
    if (!url) return null

    // Allow one nested search wrapper (for example Google -> Bing -> target)
    // without permitting arbitrary redirect chasing or network requests.
    for (let depth = 0; depth < 2; depth += 1) {
      const unwrapped = unwrapSearchEngineRedirect(url)
      if (!unwrapped) return null
      if (unwrapped.toString() === url.toString()) break
      url = unwrapped
    }

    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      const lowered = key.toLowerCase()
      if (
        lowered.startsWith('utm_')
        || lowered === 'fbclid'
        || lowered === 'gclid'
        || lowered === 'msclkid'
        || lowered === 'ved'
      ) {
        url.searchParams.delete(key)
      }
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? normalizeSpace(value).slice(0, maxLength) : ''
}

function numericValue(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const PROCUREMENT_PLAN_PURPOSE_WEIGHT: Record<QueryPurpose, number> = {
  'ai-intent': 120,
  broad: 110,
  'intent-core': 105,
  official: 100,
  document: 95,
  freshness: 90,
  portal: 85,
  semantic: 70,
}

/**
 * The server route gives some renewable providers only the first two or three
 * plan variants. If the literal query is something like "occupational health
 * exams", sending those limited slots only to broad/intent-core searches finds
 * clinic marketing pages rather than procurements. Put the buyer-language RFP
 * variant first, then preserve the literal and protected queries, while keeping
 * official/document/freshness/portal coverage inside the same bounded plan.
 */
function orderProcurementBrowserVariants<T extends { purpose: QueryPurpose; priority: number }>(variants: T[]): T[] {
  return [...variants].sort((left, right) => {
    const purposeDelta = PROCUREMENT_PLAN_PURPOSE_WEIGHT[right.purpose]
      - PROCUREMENT_PLAN_PURPOSE_WEIGHT[left.purpose]
    return purposeDelta || right.priority - left.priority
  })
}

export function buildBrowserSearchPlan(rawQuery: string, maxSearches = 8): BrowserSearchPlan {
  const bangs = parseBangs(rawQuery)
  const operators = parseSearchOperators(bangs.cleanQuery || rawQuery)
  const normalizedQuery = reconstructQuery(operators, bangs.cleanQuery || rawQuery)
  const intent = buildDeterministicSemanticIntent(normalizedQuery, 'procurement')
  const expanded = expandQuery(normalizedQuery, 'procurement')
  const variants = orderProcurementBrowserVariants(buildQueryVariants(
    normalizedQuery,
    'procurement',
    expanded,
    operators,
    new Date().getFullYear(),
    intent
  ))

  const searches = variants.slice(0, Math.max(1, Math.min(12, maxSearches))).map((variant, index) => ({
    id: `q${index + 1}`,
    query: variant.query,
    purpose: variant.purpose,
    priority: variant.priority,
  }))

  return {
    query: normalizedQuery,
    lens: 'procurement',
    intent,
    searches,
    transport: 'searxng',
    apiKeysRequired: false,
    maxResultsPerSearch: 20,
    timestamp: new Date().toISOString(),
  }
}

export function coerceBrowserIntent(value: unknown, query: string): SemanticIntentPlan {
  return coerceSemanticIntentPlan(value, query, 'procurement')
}

export function normalizeBrowserSerpCandidates(
  rawCandidates: BrowserSerpCandidateInput[],
  maxCandidates = 240
): ScrapedResult[] {
  const merged = new Map<string, ScrapedResult>()
  const limit = Math.max(1, Math.min(500, maxCandidates))

  for (const [index, raw] of rawCandidates.slice(0, limit).entries()) {
    const title = stringValue(raw.title, 500)
    const url = cleanResultUrl(stringValue(raw.url, 2_000))
    if (!title || !url) continue

    const domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    const description = stringValue(raw.description, 2_000)
    const source = stringValue(raw.source, 120) || 'SearXNG'
    const query = stringValue(raw.query, 500)
    const purpose = stringValue(raw.purpose, 80)
    const rank = Math.max(1, Math.round(numericValue(raw.rank, index + 1)))
    const score = Math.max(0, Math.min(100, numericValue(raw.score, Math.max(10, 100 - rank * 2))))
    const key = url.toLowerCase()
    const result: ScrapedResult = {
      title,
      url,
      description,
      domain,
      source,
      rank,
      score,
      resultType: 'procurement',
      retrieval: {
        sources: [source],
        queries: query ? [query] : [],
        purposes: purpose ? [purpose] : [],
        overlap: 1,
      },
    }

    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, result)
      continue
    }

    const sources = Array.from(new Set([
      ...(existing.retrieval?.sources || [existing.source]),
      source,
    ]))
    const queries = Array.from(new Set([
      ...(existing.retrieval?.queries || []),
      ...(query ? [query] : []),
    ]))
    const purposes = Array.from(new Set([
      ...(existing.retrieval?.purposes || []),
      ...(purpose ? [purpose] : []),
    ]))

    merged.set(key, {
      ...(existing.score >= result.score ? existing : result),
      description: existing.description.length >= description.length ? existing.description : description,
      retrieval: {
        sources,
        queries,
        purposes,
        overlap: sources.length,
      },
    })
  }

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score || left.rank - right.rank)
    .map((result, index) => ({ ...result, rank: index + 1 }))
}
