import { buyerLanguageTermsForQuery } from './occumed-capability-matching'
import type { ScrapedResult } from '../types/search'

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search'
const SAM_TIMEOUT_MS = 9_000
const MAX_LOOKBACK_DAYS = 364
const MAX_SAM_STRATEGIES = 8

// One compact anchor per Occu-Med capability family. These are deliberately
// buyer-facing phrases that commonly appear in solicitation titles. They run
// only inside the weak-coverage rescue path, not on every normal search.
const OCCUMED_SAM_TITLE_ANCHORS = [
  'occupational health',
  'OCONUS medical',
  'medical surveillance',
  'drug testing',
  'medical review',
] as const

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

function samSearchSpecs(query: string): SamSearchSpec[] {
  const direct = cleanTitleQuery(query)
  const buyerAliases = buyerLanguageTermsForQuery(direct || query, 5)
  const candidates: SamSearchSpec[] = [
    ...(direct.length >= 4
      ? [{ label: `title:${direct}`, params: { title: direct } }]
      : []),
    ...(buyerAliases[0]
      ? [{ label: `buyer-title:${buyerAliases[0]}`, params: { title: buyerAliases[0] } }]
      : []),
    // Q533 is the federal PSC for Occupational & Public Health Services and is
    // substantially more reliable than expecting every buyer to use one exact
    // occupational-health phrase in the notice title.
    { label: 'psc:Q533', params: { ccode: 'Q533' } },
    ...OCCUMED_SAM_TITLE_ANCHORS.map(title => ({
      label: `capability-title:${title}`,
      params: { title },
    })),
  ]

  const seen = new Set<string>()
  const output: SamSearchSpec[] = []
  for (const candidate of candidates) {
    const key = new URLSearchParams(candidate.params).toString().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(candidate)
    if (output.length >= MAX_SAM_STRATEGIES) break
  }
  return output
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
  return record.noticeId
    ? `https://sam.gov/opp/${record.noticeId}/view`
    : 'https://sam.gov/content/opportunities'
}

function classificationEvidence(record: SamOpportunityRecord): string[] {
  const psc = record.classificationCode?.trim().toUpperCase()
  return [
    psc ? `PSC ${psc}` : '',
    psc === 'Q533' ? 'Occupational and public health services' : '',
    record.naicsCode ? `NAICS ${record.naicsCode}` : '',
  ].filter(Boolean)
}

function recordDescription(record: SamOpportunityRecord): string {
  // SAM's search response can place a noticedesc API URL in `description`, so
  // only retain it when it is actual text. Structured notice metadata supplies
  // procurement evidence until package inspection opens the full notice.
  const rawDescription = record.description?.trim() || ''
  const descriptionText = /^https?:\/\//i.test(rawDescription) ? '' : rawDescription
  const parts = [
    descriptionText,
    record.type ? `Notice type: ${record.type}` : '',
    ...classificationEvidence(record),
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
    const classification = classificationEvidence(record)
    results.push({
      title,
      url,
      description: recordDescription(record),
      domain: 'sam.gov',
      source: 'SAM.gov Official API',
      rank: results.length + 1,
      score: record.classificationCode?.trim().toUpperCase() === 'Q533' ? 110 : 100,
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
        reason: 'Published active opportunity returned by the official SAM.gov Opportunities API.',
        evidence: [
          record.type ? `Notice type: ${record.type}` : '',
          ...classification,
          record.postedDate ? `Posted: ${record.postedDate}` : '',
          deadline ? `Deadline: ${deadline}` : '',
          record.solicitationNumber ? `Solicitation: ${record.solicitationNumber}` : '',
        ].filter(Boolean),
        extractedTextLength: recordDescription(record).length,
        cached: false,
        lifecycle: {
          status: deadline && !Number.isNaN(new Date(deadline).getTime()) ? 'open' : 'unknown',
          reason: deadline ? 'Official SAM.gov response deadline is not in the past.' : 'SAM.gov marks the notice active and did not provide a parseable response deadline in the search record.',
          confidence: deadline ? 0.95 : 0.8,
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
  limit = 20
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
  const specs = samSearchSpecs(query)
  const allRecords: SamOpportunityRecord[] = []
  const failures: string[] = []

  for (const spec of specs) {
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
        throw new Error(`SAM.gov returned malformed JSON for ${spec.label}`)
      }
      if (!response.ok) {
        throw new Error(`SAM.gov returned HTTP ${response.status} for ${spec.label}`)
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

  const strategyLabels = specs.map(spec => spec.label)
  const results = normalizeResults(allRecords, limit).map((result): ScrapedResult => ({
    ...result,
    retrieval: {
      sources: result.retrieval?.sources || ['SAM.gov Official API'],
      queries: strategyLabels,
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
      queryCount: specs.length,
      strategies: strategyLabels,
      ...(failures.length > 0 && results.length === 0
        ? { error: Array.from(new Set(failures)).join('; ').slice(0, 600) }
        : {}),
    },
  }
}
