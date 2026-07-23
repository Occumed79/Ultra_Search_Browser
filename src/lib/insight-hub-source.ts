import type { ScrapedResult } from '../types/search'

const DEFAULT_LIMIT = 40

export interface InsightHubOpportunity {
  id?: string
  title?: string
  description?: string | null
  agency?: string | null
  solicitationNumber?: string | null
  samUrl?: string | null
  sourceUrl?: string | null
  postedDate?: string | null
  responseDeadline?: string | null
  providerName?: string | null
  relevanceScore?: number | string | null
  relevance?: {
    score?: number | null
    confidence?: string | null
    reasons?: string[]
  } | null
}

interface InsightHubOpportunityResponse {
  data?: InsightHubOpportunity[]
  total?: number
}

export interface InsightHubSearchResult {
  text: string
  results: ScrapedResult[]
  total: number
  configured: boolean
}

function normalizeBaseUrl(value: string): URL {
  const base = new URL(value.trim())
  base.pathname = base.pathname.replace(/\/+$/, '')
  base.search = ''
  base.hash = ''
  return base
}

export function buildInsightHubOpportunitiesUrl(
  baseUrl: string,
  query: string,
  limit = DEFAULT_LIMIT
): URL {
  const base = normalizeBaseUrl(baseUrl)
  const path = base.pathname.endsWith('/api')
    ? `${base.pathname}/opportunities`
    : `${base.pathname}/api/opportunities`
  base.pathname = path.replace(/\/+/g, '/')
  base.searchParams.set('search', query)
  base.searchParams.set('view', 'actionable')
  base.searchParams.set('freshOnly', 'true')
  base.searchParams.set('status', 'active')
  base.searchParams.set('limit', String(Math.max(1, Math.min(100, limit))))
  return base
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function firstUrl(opportunity: InsightHubOpportunity): string | null {
  const candidates = [opportunity.samUrl, opportunity.sourceUrl]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return new URL(candidate).toString()
    } catch {
      // Ignore malformed source URLs rather than emitting fake results.
    }
  }
  return null
}

export function mapInsightHubOpportunity(
  opportunity: InsightHubOpportunity,
  index: number
): ScrapedResult | null {
  const title = opportunity.title?.trim()
  const url = firstUrl(opportunity)
  if (!title || !url) return null

  const details = [
    opportunity.agency,
    opportunity.solicitationNumber ? `Solicitation ${opportunity.solicitationNumber}` : null,
    opportunity.responseDeadline ? `Deadline ${opportunity.responseDeadline}` : null,
    opportunity.description,
  ].filter((value): value is string => Boolean(value && value.trim()))

  const relevance = numberValue(opportunity.relevance?.score ?? opportunity.relevanceScore)
  const confidence = opportunity.relevance?.confidence
  const sourceLabel = opportunity.providerName?.trim() || 'Insight Hub adapters'

  return {
    title,
    url,
    description: details.join(' · '),
    domain: new URL(url).hostname.replace(/^www\./, ''),
    source: `Insight Hub · ${sourceLabel}`,
    rank: index + 1,
    score: relevance,
    resultType: 'procurement',
    intelligence: {
      organization: opportunity.agency?.trim() || 'Unknown organization',
      opportunity_type: 'procurement',
      service: opportunity.description?.trim() || title,
      due_date: opportunity.responseDeadline || undefined,
      source_confidence: confidence === 'high' ? 90 : confidence === 'medium' ? 70 : relevance || 50,
      document_url: url,
      matched_signals: opportunity.relevance?.reasons || ['Insight Hub adapter-backed opportunity'],
      posted_date: opportunity.postedDate || undefined,
      status: 'active',
    },
  }
}

export async function searchInsightHubOpportunities(
  query: string,
  limit = DEFAULT_LIMIT
): Promise<InsightHubSearchResult> {
  const configuredUrl = process.env.INSIGHT_HUB_API_URL?.trim()
  if (!configuredUrl) return { text: '', results: [], total: 0, configured: false }

  const response = await fetch(buildInsightHubOpportunitiesUrl(configuredUrl, query, limit), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  })

  if (!response.ok) {
    throw new Error(`Insight Hub returned HTTP ${response.status}`)
  }

  const payload = await response.json() as InsightHubOpportunityResponse
  const rows = Array.isArray(payload.data) ? payload.data : []
  const results = rows
    .map(mapInsightHubOpportunity)
    .filter((result): result is ScrapedResult => Boolean(result))

  return {
    text: results.map(result => `${result.title} ${result.description}`).join(' '),
    results,
    total: Number.isFinite(payload.total) ? Number(payload.total) : results.length,
    configured: true,
  }
}
