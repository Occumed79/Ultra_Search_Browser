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

function cleanResultUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
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

export function buildBrowserSearchPlan(rawQuery: string, maxSearches = 8): BrowserSearchPlan {
  const bangs = parseBangs(rawQuery)
  const operators = parseSearchOperators(bangs.cleanQuery || rawQuery)
  const normalizedQuery = reconstructQuery(operators, bangs.cleanQuery || rawQuery)
  const intent = buildDeterministicSemanticIntent(normalizedQuery, 'procurement')
  const expanded = expandQuery(normalizedQuery, 'procurement')
  const variants = buildQueryVariants(
    normalizedQuery,
    'procurement',
    expanded,
    operators,
    new Date().getFullYear(),
    intent
  )

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
