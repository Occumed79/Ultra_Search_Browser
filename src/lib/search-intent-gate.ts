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

const PROCUREMENT_TERMS = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for information|rfi|request for tenders?|rft|invitation to bid|ifb|sources sought|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity|competitive sealed proposal|notice inviting bids)\b/i
const PROCUREMENT_PORTALS = /(?:ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com|publicpurchase\.com|opengov\.com|bidsandtenders\.com)/i
const GENERIC_PAGE_TITLE = /\b(?:definition|meaning|dictionary|encyclopedia|occupational outlook handbook|licensing|license lookup|career guide|jobs?|home|a[- ]?z index|topic index|directory|therapy)\b/i
const BROAD_OCCUMED_SERVICE_QUERY = /\b(?:employment|employee|occupational|workforce|pre employment|medical|fitness for duty|fit for duty)\b.*\b(?:evaluation|evaluations|exam|exams|examination|examinations|physical|physicals|screening|screenings|health|medicine|clearance)\b/i
const NON_MEDICAL_EMPLOYMENT_QUERY = /\b(?:performance|appraisal|employee review|human resources|hr evaluation|training evaluation)\b/i
const PROCUREMENT_TARGETED_PURPOSES = new Set(['ai-intent', 'official', 'document', 'freshness', 'portal'])
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

  // A buyer may describe the same capability with a different phrase. Match
  // within the requested capability family—for example, pre-deployment health
  // assessment can match medical readiness or contractor medical clearance,
  // and program management can match occupational-health administration.
  if (
    queryCapabilities.size > 0
    && candidateCapability.matchedCapabilities.some(label => queryCapabilities.has(label))
  ) {
    return true
  }

  // Preserve a broader fallback for vague medical-employment searches while
  // keeping non-medical HR/performance-evaluation queries outside the product.
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
 * SearXNG and ordinary search engines frequently return sparse snippets that
 * omit words such as RFP/solicitation even when the result came from an
 * explicitly procurement-targeted query. Preserve that provenance so the
 * destination-page validator, not the SERP snippet, makes the final decision.
 */
function retrievalSignalsProcurementIntent(result: ScrapedResult): boolean {
  const purposes = result.retrieval?.purposes || []
  if (purposes.some(purpose => PROCUREMENT_TARGETED_PURPOSES.has(purpose))) return true

  const queries = result.retrieval?.queries || []
  return queries.some(retrievalQuery =>
    PROCUREMENT_TERMS.test(retrievalQuery)
    || PROCUREMENT_PORTALS.test(retrievalQuery)
  )
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
  if (!hasDirectProcurementEvidence && !hasProcurementRetrievalContext) {
    return 'missing-procurement-evidence'
  }

  if (!subjectMatches(query, text, semanticIntent)) return 'missing-query-subject'

  // At snippet stage, reject only explicit out-of-scope evidence. Sparse snippets
  // reached through procurement-targeted searches are intentionally allowed to
  // continue so destination-page review can confirm or reject the opportunity.
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
