import type { ScrapedResult } from '../types/search'

export interface SamGovEnvironment {
  [key: string]: string | undefined
  SAM_GOV_API_KEY?: string
  SAM_API_KEY?: string
}

export interface SamGovSearchDiagnostics {
  configured: boolean
  attemptedRequests: number
  successfulRequests: number
  failedRequests: number
  rawRecords: number
  resultCount: number
  queries: string[]
  failures: string[]
}

interface SamGovOpportunity {
  noticeId?: unknown
  title?: unknown
  solicitationNumber?: unknown
  fullParentPathName?: unknown
  department?: unknown
  subTier?: unknown
  office?: unknown
  postedDate?: unknown
  type?: unknown
  baseType?: unknown
  archiveDate?: unknown
  responseDeadLine?: unknown
  active?: unknown
  naicsCode?: unknown
  classificationCode?: unknown
  additionalInfoLink?: unknown
  placeOfPerformance?: {
    city?: { name?: unknown }
    state?: { code?: unknown }
    country?: { name?: unknown; code?: unknown }
  }
}

interface SamGovEnvelope {
  opportunitiesData?: unknown
}

type SearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const ENDPOINT = 'https://api.sam.gov/opportunities/v2/search'
const REQUEST_TIMEOUT_MS = 12_000
const RESULT_LIMIT = 30

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = clean(value)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function apiKey(environment: SamGovEnvironment): string {
  return environment.SAM_GOV_API_KEY?.trim() || environment.SAM_API_KEY?.trim() || ''
}

export function samGovOpportunityCapabilities(
  environment: SamGovEnvironment = process.env
): { configured: boolean } {
  return { configured: Boolean(apiKey(environment)) }
}

function utcDate(value: Date): string {
  return `${String(value.getUTCMonth() + 1).padStart(2, '0')}/${String(value.getUTCDate()).padStart(2, '0')}/${value.getUTCFullYear()}`
}

function searchWindow(now: Date): { postedFrom: string; postedTo: string } {
  const postedTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const postedFrom = new Date(postedTo)
  postedFrom.setUTCFullYear(postedFrom.getUTCFullYear() - 1)
  postedFrom.setUTCDate(postedFrom.getUTCDate() + 1)
  return {
    postedFrom: utcDate(postedFrom),
    postedTo: utcDate(postedTo),
  }
}

function asOpportunities(value: unknown): SamGovOpportunity[] {
  return Array.isArray(value)
    ? value.filter((item): item is SamGovOpportunity => Boolean(item && typeof item === 'object'))
    : []
}

function locationOf(opportunity: SamGovOpportunity): string {
  return unique([
    clean(opportunity.placeOfPerformance?.city?.name),
    clean(opportunity.placeOfPerformance?.state?.code),
    clean(opportunity.placeOfPerformance?.country?.name || opportunity.placeOfPerformance?.country?.code),
  ]).join(', ')
}

function descriptionOf(opportunity: SamGovOpportunity): string {
  const lines = [
    clean(opportunity.type || opportunity.baseType),
    clean(opportunity.fullParentPathName || opportunity.department || opportunity.subTier || opportunity.office),
    clean(opportunity.solicitationNumber) ? `Solicitation ${clean(opportunity.solicitationNumber)}` : '',
    clean(opportunity.postedDate) ? `Posted ${clean(opportunity.postedDate)}` : '',
    clean(opportunity.responseDeadLine) ? `Responses due ${clean(opportunity.responseDeadLine)}` : '',
    locationOf(opportunity) ? `Place of performance: ${locationOf(opportunity)}` : '',
    clean(opportunity.naicsCode) ? `NAICS ${clean(opportunity.naicsCode)}` : '',
  ]
  return unique(lines).join(' · ')
}

function normalizeResults(records: SamGovOpportunity[], query: string): ScrapedResult[] {
  const seen = new Set<string>()
  const results: ScrapedResult[] = []

  for (const opportunity of records) {
    const noticeId = clean(opportunity.noticeId)
    const title = clean(opportunity.title)
    const active = clean(opportunity.active).toLowerCase()
    if (!noticeId || !title || (active && active !== 'yes' && active !== 'true')) continue
    if (seen.has(noticeId.toLowerCase())) continue
    seen.add(noticeId.toLowerCase())

    results.push({
      title,
      url: `https://sam.gov/opp/${encodeURIComponent(noticeId)}/view`,
      description: descriptionOf(opportunity),
      domain: 'sam.gov',
      source: 'SAM.gov',
      rank: results.length + 1,
      score: 0,
      retrieval: {
        sources: ['SAM.gov'],
        queries: [query],
        purposes: ['procurement-api'],
        overlap: 1,
      },
    })
    if (results.length >= RESULT_LIMIT) break
  }

  return results
}

async function searchTitle(
  title: string,
  key: string,
  now: Date,
  fetchImpl: SearchFetch
): Promise<{ records: SamGovOpportunity[]; failure?: string }> {
  const { postedFrom, postedTo } = searchWindow(now)
  const url = new URL(ENDPOINT)
  url.searchParams.set('api_key', key)
  url.searchParams.set('postedFrom', postedFrom)
  url.searchParams.set('postedTo', postedTo)
  url.searchParams.set('limit', '50')
  url.searchParams.set('offset', '0')
  url.searchParams.set('title', title)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (response.status === 404) return { records: [] }
    if (!response.ok) return { records: [], failure: `HTTP ${response.status}` }

    const text = await response.text()
    let envelope: SamGovEnvelope = {}
    try {
      envelope = text ? JSON.parse(text) as SamGovEnvelope : {}
    } catch {
      return { records: [], failure: 'malformed JSON' }
    }
    return { records: asOpportunities(envelope.opportunitiesData) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { records: [], failure: message.slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

export async function searchSamGovOpportunities(
  queries: string[],
  environment: SamGovEnvironment = process.env,
  fetchImpl: SearchFetch = fetch,
  now = new Date()
): Promise<{ results: ScrapedResult[]; diagnostics: SamGovSearchDiagnostics }> {
  const key = apiKey(environment)
  const searchQueries = unique(queries).slice(0, 4)
  if (!key || searchQueries.length === 0) {
    return {
      results: [],
      diagnostics: {
        configured: Boolean(key),
        attemptedRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        rawRecords: 0,
        resultCount: 0,
        queries: searchQueries,
        failures: [],
      },
    }
  }

  const settled = await Promise.all(searchQueries.map(query => searchTitle(query, key, now, fetchImpl)))
  const rawRecords = settled.flatMap(item => item.records)
  const results = normalizeResults(rawRecords, searchQueries[0])
  const failures = settled.flatMap((item, index) =>
    item.failure ? [`${searchQueries[index]}: ${item.failure}`] : []
  )

  return {
    results,
    diagnostics: {
      configured: true,
      attemptedRequests: settled.length,
      successfulRequests: settled.filter(item => !item.failure).length,
      failedRequests: failures.length,
      rawRecords: rawRecords.length,
      resultCount: results.length,
      queries: searchQueries,
      failures,
    },
  }
}
