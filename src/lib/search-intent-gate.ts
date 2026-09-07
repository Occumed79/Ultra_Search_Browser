import { matchOccuMedCapabilityGroups } from './occumed-capability-matching'
import { assessOccuMedRfpText } from './occumed-rfp-profile'
import type { SemanticIntentPlan } from './semantic-intent'
import type { ScrapedResult, SearchLens } from '../types/search'

export interface IntentGateDiagnostics {
  applied: boolean
  retained: number
  rejected: number
  reasons: Record<string, number>
}

const PROCUREMENT_TERMS = /\b(?:request for proposals?|rfp|request for quot(?:e|es|ation|ations)|rfq|request for information|rfi|request for tenders?|rft|invitation (?:to|for) bids?|ifb|sources sought|solicitation|tender|bid(?:ding)?|procurement|contract (?:opportunity|notice)|bid opportunity|business opportunity|vendor opportunity|notice of intent|competitive sealed proposal|notice inviting bids)\b/i
const PROCUREMENT_PORTALS = /(?:sam\.gov|ebuy\.gsa\.gov|piee\.eb\.mil|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com|publicpurchase\.com|opengov\.com|bidsandtenders\.com|bidexpress\.com|demandstar\.com|vendorregistry\.com|jaggaer\.com|sciquest\.com|ariba\.com|coupa\.com|periscopeholdings\.com)/i
const PROCUREMENT_DESTINATION_HINTS = /(?:^|[\/_-])(?:opp(?:s|ortunit(?:y|ies))?|procurement|purchasing|bids?|rfps?|rfqs?|rfis?|solicitations?|tenders?|vendor|suppliers?|contract-opportunit(?:y|ies)|business-opportunit(?:y|ies)|opportunities|notices?|events?|sourcing|acquisition|documentcenter|documents?|downloads?|attachments?)(?:[\/_?.#=-]|$)/i
const GENERIC_PAGE_TITLE = /\b(?:definition|meaning|dictionary|encyclopedia|occupational outlook handbook|licensing|license lookup|career guide|jobs?|home|a[- ]?z index|topic index|directory|therapy)\b/i
const BROAD_OCCUMED_SERVICE_QUERY = /\b(?:employment|employee|occupational|workforce|pre employment|medical|fitness for duty|fit for duty)\b.*\b(?:evaluation|evaluations|exam|exams|examination|examinations|physical|physicals|screening|screenings|health|medicine|clearance)\b/i
const NON_MEDICAL_EMPLOYMENT_QUERY = /\b(?:performance|appraisal|employee review|human resources|hr evaluation|training evaluation)\b/i
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with',
  'find', 'search', 'show', 'request', 'requests', 'proposal', 'proposals', 'quotation', 'quotations', 'tender', 'tenders',
  'rfp', 'rfq', 'rfi', 'rft', 'ifb', 'bid', 'bids', 'bidding', 'solicitation', 'procurement', 'contract',
  'opportunity', 'opportunities', 'vendor', 'current', 'open', 'active',
])

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function subjectTokens(query: string): string[] {
  return Array.from(new Set(
    normalize(query)
      .split(' ')
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token))
  )).slice(0, 10)
}

function subjectMatches(
  query: string,
  text: string,
  semanticIntent?: SemanticIntentPlan
): boolean {
  const normalizedQuery = normalize(query)
  const queryCapabilities = new Set(
    matchOccuMedCapabilityGroups(query, 3).map(group => group.label)
  )
  const candidateCapability = assessOccuMedRfpText(text)

  if (
    queryCapabilities.size > 0
    && candidateCapability.matchedCapabilities.some(label => queryCapabilities.has(label))
  ) {
    return true
  }

  if (
    BROAD_OCCUMED_SERVICE_QUERY.test(normalizedQuery)
    && !NON_MEDICAL_EMPLOYMENT_QUERY.test(normalizedQuery)
    && candidateCapability.status !== 'irrelevant'
  ) {
    return true
  }

  const subjectGroups = semanticIntent?.conceptGroups.filter(group =>
    group.required && group.kind !== 'format' && group.kind !== 'geography' && group.kind !== 'time'
  ) || []
  if (subjectGroups.length > 0) {
    return subjectGroups.some(group =>
      group.terms.some(term => {
        const normalized = normalize(term)
        return normalized.length >= 3 && text.includes(normalized)
      })
    )
  }
  const required = subjectTokens(query)
  return required.length === 0 || required.some(token => text.includes(token))
}

/**
 * A procurement-targeted retrieval query is useful corroborating evidence, but
 * it can never by itself turn an ordinary clinic/provider webpage into an RFP.
 * Candidate ingest therefore combines retrieval provenance with an actual
 * procurement-looking destination whenever the snippet itself is sparse.
 */
function retrievalSignalsProcurementIntent(result: ScrapedResult): boolean {
  const queries = result.retrieval?.queries || []
  return queries.some(retrievalQuery =>
    PROCUREMENT_TERMS.test(retrievalQuery)
    || PROCUREMENT_PORTALS.test(retrievalQuery)
  )
}

function destinationSignalsProcurement(result: ScrapedResult): boolean {
  if (PROCUREMENT_PORTALS.test(result.url)) return true

  try {
    const url = new URL(result.url)
    const pathAndQuery = `${url.pathname}${url.search}`
    if (PROCUREMENT_DESTINATION_HINTS.test(pathAndQuery)) return true
    if (/\.(?:pdf|docx?)(?:$|[?#])/i.test(pathAndQuery)) return true

    const host = url.hostname.toLowerCase()
    if (/\b(?:procurement|purchasing|bids?|vendor|supplier|sourcing|tender|acquisition|eproc)\b/i.test(host.replace(/[.-]+/g, ' '))) return true
  } catch {
    return false
  }

  return false
}

function rejectReason(
  query: string,
  result: ScrapedResult,
  semanticIntent?: SemanticIntentPlan
): string | undefined {
  const title = normalize(result.title)
  const text = normalize(`${result.title} ${result.description} ${result.url} ${result.domain}`)
  const originalText = `${result.title} ${result.description} ${result.url} ${result.domain}`

  if (GENERIC_PAGE_TITLE.test(result.title)) return 'generic-definition-or-index'

  const hasDirectProcurementEvidence = PROCUREMENT_TERMS.test(originalText)
    || PROCUREMENT_PORTALS.test(result.url)
  const hasProcurementRetrievalContext = retrievalSignalsProcurementIntent(result)
  const hasProcurementDestination = destinationSignalsProcurement(result)
  if (
    !hasDirectProcurementEvidence
    && !(hasProcurementRetrievalContext && hasProcurementDestination)
  ) {
    return 'missing-procurement-evidence'
  }

  if (!subjectMatches(query, text, semanticIntent)) return 'missing-query-subject'

  const occuMed = assessOccuMedRfpText(originalText)
  if (occuMed.status === 'irrelevant' && occuMed.exclusions.length > 0) {
    return 'outside-occumed-service-model'
  }

  if (!title && !result.description.trim()) return 'empty-result'
  return undefined
}

export function applyIntentCandidateGate(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[],
  semanticIntent?: SemanticIntentPlan
): { results: ScrapedResult[]; diagnostics: IntentGateDiagnostics } {
  if (lens !== 'procurement') {
    return {
      results,
      diagnostics: { applied: false, retained: results.length, rejected: 0, reasons: {} },
    }
  }

  const reasons: Record<string, number> = {}
  const retained = results.filter(result => {
    const reason = rejectReason(query, result, semanticIntent)
    if (!reason) return true
    reasons[reason] = (reasons[reason] || 0) + 1
    return false
  })

  return {
    results: retained,
    diagnostics: {
      applied: true,
      retained: retained.length,
      rejected: results.length - retained.length,
      reasons,
    },
  }
}
