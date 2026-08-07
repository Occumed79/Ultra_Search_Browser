import type { ScrapedResult } from '../types/search'

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search'
const SAM_TIMEOUT_MS = 9_000
const MAX_LOOKBACK_DAYS = 364

interface SamOpportunityRecord {
  noticeId?: string
  title?: string
  solicitationNumber?: string
  fullParentPathName?: string
  department?: string
  subTier?: string
  office?: string
  postedDate?: string
  type?: string
  baseType?: string
  archiveDate?: string
  archiveType?: string
  additionalInfoLink?: string
  uiLink?: string
  responseDeadLine?: string
  responseDeadline?: string
  description?: string
}

interface SamSearchPayload {
  totalRecords?: number
  opportunitiesData?: SamOpportunityRecord[]
  opportunities?: SamOpportunityRecord[]
  data?: SamOpportunityRecord[]
}

export interface SamGovSearchDiagnostics {
  configured: boolean
  attempted: boolean
  successful: boolean
  resultCount: number
  queryCount: number
  error?: string
}

function formatSamDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${month}/${day}/${date.getUTCFullYear()}`
}

function titleQueries(query: string): string[] {
  const cleaned = query
    .replace(/\b(?:request for proposals?|rfp|request for quotations?|rfq|solicitation|tender|bid|procurement|opportunities?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const candidates = [
    cleaned,
    cleaned.replace(/\bservices?\b/gi, '').replace(/\s+/g, ' ').trim(),
  ]
  return Array.from(new Set(candidates.filter(value => value.length >= 4))).slice(0, 2)
}

function responseDeadline(record: SamOpportunityRecord): string | undefined {
  return record.responseDeadLine || record.responseDeadline
}

function isStillActionable(record: SamOpportunityRecord): boolean {
  const deadline = responseDeadline(record)
  if (!deadline) return true
  const parsed = new Date(deadline)
  return Number.isNaN(parsed.getTime()) || parsed.getTime() >= Date.now()
}

function organization(record: SamOpportunityRecord): string {
  return record.fullParentPathName || record.department || record.subTier || record.office || 'SAM.gov'
}

function recordUrl(record: SamOpportunityRecord): string {
  if (record.uiLink?.startsWith('http')) return record.uiLink
  if (record.additionalInfoLink?.startsWith('http')) return record.additionalInfoLink
  return record.noticeId
    ? `https://sam.gov/opp/${record.noticeId}/view`
    : 'https://sam.gov/content/opportunities'
}

function recordDescription(record: SamOpportunityRecord): string {
  const parts = [
    record.description,
    organization(record),
    record.solicitationNumber ? `Solicitation ${record.solicitationNumber}` : '',
    record.postedDate ? `Posted ${record.postedDate}` : '',
    responseDeadline(record) ? `Responses due ${responseDeadline(record)}` : '',
  ].filter(Boolean)
  return parts.join(' · ').slice(0, 1_500)
}

function normalizeResults(records: SamOpportunityRecord[], limit: number): ScrapedResult[] {
  const seen = new Set<string>()
  const results: ScrapedResult[] = []

  for (const record of records) {
    const title = record.title?.trim()
    if (!title || !isStillActionable(record)) continue
    const url = recordUrl(record)
    const key = `${record.noticeId || url}:${record.solicitationNumber || title}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const deadline = responseDeadline(record)
    results.push({
      title,
      url,
      description: recordDescription(record),
      domain: 'sam.gov',
      source: 'SAM.gov Official API',
      rank: results.length + 1,
      score: 100,
      retrieval: {
        sources: ['SAM.gov Official API'],
        queries: [],
        purposes: ['official-procurement-api'],
        overlap: 1,
      },
      pageValidation: {
        checkedAt: new Date().toISOString(),
        requestedUrl: url,
        finalUrl: url,
        availability: 'reachable',
        reason: 'Published opportunity returned by the official SAM.gov Opportunities API.',
        evidence: [
          record.postedDate ? `Posted: ${record.postedDate}` : '',
          deadline ? `Deadline: ${deadline}` : '',
          record.solicitationNumber ? `Solicitation: ${record.solicitationNumber}` : '',
        ].filter(Boolean),
        extractedTextLength: recordDescription(record).length,
        cached: false,
        lifecycle: {
          status: deadline && !Number.isNaN(new Date(deadline).getTime()) ? 'open' : 'unknown',
          reason: deadline ? 'Official SAM.gov response deadline is not in the past.' : 'SAM.gov did not provide a parseable response deadline in the search record.',
          confidence: deadline ? 0.95 : 0.65,
          dates: [
            ...(record.postedDate ? [{
              kind: 'posted' as const,
              value: record.postedDate,
              iso: record.postedDate,
              context: 'SAM.gov posted date',
            }] : []),
            ...(deadline ? [{
              kind: 'due' as const,
              value: deadline,
              iso: deadline,
              context: 'SAM.gov response deadline',
            }] : []),
          ],
        },
      },
    })
    if (results.length >= limit) break
  }

  return results
}

export async function searchSamGovOfficial(
  query: string,
  limit = 12
): Promise<{ results: ScrapedResult[]; diagnostics: SamGovSearchDiagnostics }> {
  const apiKey = process.env.SAM_GOV_API_KEY?.trim()
  if (!apiKey) {
    return {
      results: [],
      diagnostics: {
        configured: false,
        attempted: false,
        successful: false,
        resultCount: 0,
        queryCount: 0,
      },
    }
  }

  const now = new Date()
  const postedFrom = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const queries = titleQueries(query)
  if (queries.length === 0) queries.push(query.trim())

  const allRecords: SamOpportunityRecord[] = []
  const failures: string[] = []

  for (const title of queries) {
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: String(Math.max(1, Math.min(100, limit))),
      offset: '0',
      postedFrom: formatSamDate(postedFrom),
      postedTo: formatSamDate(now),
      title,
    })

    try {
      const response = await fetch(`${SAM_API_BASE}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(SAM_TIMEOUT_MS),
      })
      const text = await response.text()
      let payload: SamSearchPayload = {}
      try {
        payload = text ? JSON.parse(text) as SamSearchPayload : {}
      } catch {
        throw new Error('SAM.gov returned malformed JSON')
      }
      if (!response.ok) {
        throw new Error(`SAM.gov returned HTTP ${response.status}`)
      }
      const records = Array.isArray(payload.opportunitiesData)
        ? payload.opportunitiesData
        : Array.isArray(payload.opportunities)
          ? payload.opportunities
          : Array.isArray(payload.data)
            ? payload.data
            : []
      allRecords.push(...records)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  const results = normalizeResults(allRecords, limit).map(result => ({
    ...result,
    retrieval: {
      ...result.retrieval,
      queries,
    },
  }))

  return {
    results,
    diagnostics: {
      configured: true,
      attempted: true,
      successful: results.length > 0,
      resultCount: results.length,
      queryCount: queries.length,
      ...(failures.length > 0 && results.length === 0
        ? { error: Array.from(new Set(failures)).join('; ').slice(0, 400) }
        : {}),
    },
  }
}
