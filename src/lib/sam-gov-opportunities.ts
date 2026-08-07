import {
  buyerLanguageTermsForQuery,
  isBroadOccuMedCapabilityQuery,
} from './occumed-capability-matching'
import type { ScrapedResult } from '../types/search'

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search'
const SAM_TIMEOUT_MS = 9_000
const MAX_LOOKBACK_DAYS = 364
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 6 * 60 * 60 * 1000
let samRateLimitedUntil = 0

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
  active?: string
  classificationCode?: string
  naicsCode?: string
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

interface SamSearchSpec {
  label: string
  params: Record<string, string>
}

export interface SamGovSearchDiagnostics {
  configured: boolean
  attempted: boolean
  successful: boolean
  resultCount: number
  queryCount: number
  strategies?: string[]
  cooldownUntil?: string
  error?: string
}

function formatSamDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${month}/${day}/${date.getUTCFullYear()}`
}

function cleanTitleQuery(query: string): string {
  return query
    .replace(/\b(?:request for proposals?|rfp|request for quotations?|rfq|solicitation|tender|bid|procurement|opportunities?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function samSearchSpec(query: string): SamSearchSpec {
  if (isBroadOccuMedCapabilityQuery(query)) {
    return { label: 'psc:Q533', params: { ccode: 'Q533' } }
  }

  const direct = cleanTitleQuery(query)
  const buyerAlias = buyerLanguageTermsForQuery(direct || query, 1)[0]
  const title = buyerAlias || direct || query.trim()
  return {
    label: buyerAlias ? `buyer-title:${buyerAlias}` : `title:${title}`,
    params: { title },
  }
}

function responseDeadline(record: SamOpportunityRecord): string | undefined {
  return record.responseDeadLine || record.responseDeadline
}

function isStillActionable(record: SamOpportunityRecord): boolean {
  if (record.active && !/^yes$/i.test(record.active.trim())) return false
  const noticeType = `${record.type || ''} ${record.baseType || ''}`
  if (/\b(?:award notice|justification|sale of surplus)\b/i.test(noticeType)) return false
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
  return record.noticeId ? `https://sam.gov/opp/${record.noticeId}/view` : 'https://sam.gov/content/opportunities'
}

function classificationEvidence(record: SamOpportunityRecord): string[] {
  const psc = record.classificationCode?.trim().toUpperCase()
  return [
    psc ? `PSC ${psc}` : '',
    psc === 'Q533' ? 'Occupational and public health services' : '',
    psc === 'Q533' ? 'Occupational health services' : '',
    record.naicsCode ? `NAICS ${record.naicsCode}` : '',
  ].filter(Boolean)
}

function recordDescription(record: SamOpportunityRecord): string {
  const rawDescription = record.description?.trim() || ''
  const descriptionText = /^https?:\/\//i.test(rawDescription) ? '' : rawDescription
  return [
    descriptionText,
    record.type ? `Notice type: ${record.type}` : '',
    ...classificationEvidence(record),
    organization(record),
    record.solicitationNumber ? `Solicitation ${record.solicitationNumber}` : '',
    record.postedDate ? `Posted ${record.postedDate}` : '',
    responseDeadline(record) ? `Responses due ${responseDeadline(record)}` : '',
  ].filter(Boolean).join(' · ').slice(0, 1_500)
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
    const classification = classificationEvidence(record)
    results.push({
      title,
      url,
      description: recordDescription(record),
      domain: 'sam.gov',
      source: 'SAM.gov Official API',
      rank: results.length + 1,
      score: record.classificationCode?.trim().toUpperCase() === 'Q533' ? 110 : 100,
      retrieval: { sources: ['SAM.gov Official API'], queries: [], purposes: ['official-procurement-api'], overlap: 1 },
      pageValidation: {
        checkedAt: new Date().toISOString(),
        requestedUrl: url,
        finalUrl: url,
        availability: 'reachable',
        reason: 'Published active opportunity returned by the official SAM.gov Opportunities API.',
        evidence: [record.type ? `Notice type: ${record.type}` : '', ...classification, record.postedDate ? `Posted: ${record.postedDate}` : '', deadline ? `Deadline: ${deadline}` : '', record.solicitationNumber ? `Solicitation: ${record.solicitationNumber}` : ''].filter(Boolean),
        extractedTextLength: recordDescription(record).length,
        cached: false,
        lifecycle: {
          status: deadline && !Number.isNaN(new Date(deadline).getTime()) ? 'open' : 'unknown',
          reason: deadline ? 'Official SAM.gov response deadline is not in the past.' : 'SAM.gov marks the notice active and did not provide a parseable response deadline.',
          confidence: deadline ? 0.95 : 0.8,
          dates: [
            ...(record.postedDate ? [{ kind: 'posted' as const, value: record.postedDate, iso: record.postedDate, context: 'SAM.gov posted date' }] : []),
            ...(deadline ? [{ kind: 'due' as const, value: deadline, iso: deadline, context: 'SAM.gov response deadline' }] : []),
          ],
        },
      },
    })
    if (results.length >= limit) break
  }
  return results
}

function rateLimitCooldown(response: Response): number {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(24 * 60 * 60 * 1000, seconds * 1000)
    const timestamp = Date.parse(retryAfter)
    if (Number.isFinite(timestamp) && timestamp > Date.now()) return Math.min(24 * 60 * 60 * 1000, timestamp - Date.now())
  }
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS
}

export async function searchSamGovOfficial(
  query: string,
  limit = 20
): Promise<{ results: ScrapedResult[]; diagnostics: SamGovSearchDiagnostics }> {
  const apiKey = process.env.SAM_GOV_API_KEY?.trim()
  if (!apiKey) {
    return { results: [], diagnostics: { configured: false, attempted: false, successful: false, resultCount: 0, queryCount: 0 } }
  }
  if (Date.now() < samRateLimitedUntil) {
    return {
      results: [],
      diagnostics: {
        configured: true,
        attempted: false,
        successful: false,
        resultCount: 0,
        queryCount: 0,
        cooldownUntil: new Date(samRateLimitedUntil).toISOString(),
        error: 'SAM.gov is cooling down after a rate-limit response',
      },
    }
  }

  const now = new Date()
  const postedFrom = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const spec = samSearchSpec(query)
  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(Math.max(1, Math.min(100, limit))),
    offset: '0',
    postedFrom: formatSamDate(postedFrom),
    postedTo: formatSamDate(now),
    ...spec.params,
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
    if (response.status === 429) {
      samRateLimitedUntil = Date.now() + rateLimitCooldown(response)
      return {
        results: [],
        diagnostics: {
          configured: true,
          attempted: true,
          successful: false,
          resultCount: 0,
          queryCount: 1,
          strategies: [spec.label],
          cooldownUntil: new Date(samRateLimitedUntil).toISOString(),
          error: `SAM.gov returned HTTP 429 for ${spec.label}`,
        },
      }
    }
    if (!response.ok) throw new Error(`SAM.gov returned HTTP ${response.status} for ${spec.label}`)

    const records = Array.isArray(payload.opportunitiesData)
      ? payload.opportunitiesData
      : Array.isArray(payload.opportunities)
        ? payload.opportunities
        : Array.isArray(payload.data)
          ? payload.data
          : []
    const results = normalizeResults(records, limit).map((result): ScrapedResult => ({
      ...result,
      retrieval: {
        sources: result.retrieval?.sources || ['SAM.gov Official API'],
        queries: [spec.label],
        purposes: result.retrieval?.purposes || ['official-procurement-api'],
        overlap: result.retrieval?.overlap || 1,
      },
    }))
    return {
      results,
      diagnostics: {
        configured: true,
        attempted: true,
        successful: results.length > 0,
        resultCount: results.length,
        queryCount: 1,
        strategies: [spec.label],
      },
    }
  } catch (error) {
    return {
      results: [],
      diagnostics: {
        configured: true,
        attempted: true,
        successful: false,
        resultCount: 0,
        queryCount: 1,
        strategies: [spec.label],
        error: error instanceof Error ? error.message.slice(0, 600) : String(error).slice(0, 600),
      },
    }
  }
}
