import type { DeepValidationOutcome } from './deep-validation'
import {
  OCCUMED_PROFILE_VERSION,
  assessOccuMedRfpText,
  type OccuMedRelevanceAssessment,
} from './occumed-rfp-profile'
import { matchOccuMedHistoricalPatterns } from './occumed-historical-pursuits'
import {
  structuredRfpReviewText,
  type RfpOpportunityIntelligence,
} from './rfp-opportunity-intelligence'
import type {
  ResultBucket,
  ScrapedResult,
  SearchResultBuckets,
  SearchValidationProgress,
} from '../types/search'

export type OccuMedDisplayDecision = 'SHOW' | 'REVIEW' | 'REJECT'

export interface OccuMedResultDecision {
  decision: OccuMedDisplayDecision
  reason: string
  procurementConfirmed: boolean
  activeConfirmed: boolean
  capabilityConfirmed: boolean
  noHardDisqualifier: boolean
  lifecycleStatus: string
  profileVersion: string
  relevance: OccuMedRelevanceAssessment
  historicalMatches: ReturnType<typeof matchOccuMedHistoricalPatterns>
  opportunityFitScore?: number
  opportunityFitBand?: RfpOpportunityIntelligence['fitBand']
}

export interface OccuMedDecisionGateDiagnostics {
  profileVersion: string
  show: number
  review: number
  reject: number
  reasons: Record<string, number>
}

export interface OccuMedGatedOutcome extends DeepValidationOutcome {
  diagnostics: DeepValidationOutcome['diagnostics'] & {
    occuMedDecisionGate: OccuMedDecisionGateDiagnostics
  }
}

type RfpDecisionCandidate = ScrapedResult & {
  rfpIntelligence?: RfpOpportunityIntelligence
}

const PROCUREMENT_EVIDENCE = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for information|rfi|invitation to bid|ifb|invitation for bids?|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|sources sought|notice of intent)\b/gi
const PROCUREMENT_DESTINATION = /(?:ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com|publicpurchase\.com|opengov\.com|bidsandtenders\.com|\/(?:procurement|purchasing|bids?|bid-opportunities|solicitations?|opportunities|contract-opportunities|vendor-opportunities|rfps?|rfqs?|ifbs?)(?:\/|$|[-_])|\.(?:pdf|docx?)(?:$|[?#]))/i
const FINAL_LIFECYCLE = new Set(['expired', 'closed', 'cancelled', 'awarded', 'stale', 'dead', 'junk'])
const ACTIVE_LIFECYCLE = new Set(['open', 'active'])
const HARD_REJECT_AVAILABILITY = new Set(['dead', 'generic', 'search-page', 'thin'])
const REVIEW_AVAILABILITY = new Set(['blocked', 'login', 'unsupported', 'error'])

function resultEvidenceText(result: RfpDecisionCandidate): string {
  return [
    result.rfpIntelligence ? structuredRfpReviewText(result.rfpIntelligence) : undefined,
    result.title,
    result.description,
    result.url,
    result.domain,
    result.content,
    result.pageValidation?.evidence.join(' '),
    result.pageValidation?.lifecycle.reason,
    result.pageValidation?.lifecycle.dates.map(date => date.context).join(' '),
  ].filter(Boolean).join(' ')
}

function evidenceClauseBefore(text: string, index: number): string {
  // Procurement vocabulary may occur hundreds of characters after a negation
  // inside a long provider-marketing sentence. Looking back only a tiny fixed
  // window turns "contains no ... solicitation" into false affirmative evidence.
  // Bound the scan for safety, but recover the whole current clause/sentence.
  const prefix = text.slice(Math.max(0, index - 1_200), index)
  const boundary = Math.max(
    prefix.lastIndexOf('.'),
    prefix.lastIndexOf('!'),
    prefix.lastIndexOf('?'),
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf('\n')
  )
  return prefix.slice(boundary + 1).toLowerCase()
}

/**
 * Procurement words in negated prose are not procurement evidence. This keeps
 * pages such as "we are a clinic, not an RFP" or "contains no bid notice" from
 * becoming opportunities merely because they contain the vocabulary Ultra
 * Search is looking for.
 */
export function hasAffirmativeProcurementEvidence(text: string): boolean {
  for (const match of text.matchAll(new RegExp(PROCUREMENT_EVIDENCE.source, PROCUREMENT_EVIDENCE.flags))) {
    const index = match.index || 0
    const clause = evidenceClauseBefore(text, index)
    const negated = /\b(?:contains?|includes?|has)\s+no\b/.test(clause)
      || /\bdoes\s+not\s+(?:contain|include|represent|constitute|provide)\b/.test(clause)
      || /\b(?:is|are|was|were)\s+not\s+(?:an?\s+)?(?:rfp|rfq|rfi|bid|solicitation|tender|procurement|contract opportunity)\b/.test(clause)
      || /\bnot\s+(?:an?\s+)?(?:rfp|rfq|rfi|bid|solicitation|tender|procurement|contract opportunity)\b/.test(clause)
      || /\bwithout\s+(?:an?\s+)?(?:rfp|rfq|rfi|bid|solicitation|tender|procurement|contract opportunity)\b/.test(clause)
      || /\bno\s+(?:current\s+|active\s+)?(?:rfp|rfq|rfi|bid|solicitation|tender|procurement|contract opportunity)\b/.test(clause)

    if (!negated) return true
  }
  return false
}

function decisionReasonKey(decision: OccuMedResultDecision): string {
  if (decision.decision === 'SHOW') return 'active-relevant-opportunity'
  if (!decision.procurementConfirmed) return 'not-a-procurement-opportunity'
  if (!decision.noHardDisqualifier) return 'hard-exclusion'
  if (FINAL_LIFECYCLE.has(decision.lifecycleStatus)) return `lifecycle-${decision.lifecycleStatus}`
  if (!decision.activeConfirmed) return 'open-status-not-confirmed'
  if (!decision.capabilityConfirmed) return 'not-an-occumed-capability'
  return decision.decision === 'REVIEW' ? 'needs-human-review' : 'rejected-by-evidence'
}

function decisionFields(
  result: RfpDecisionCandidate,
  relevance: OccuMedRelevanceAssessment,
  historicalMatches: ReturnType<typeof matchOccuMedHistoricalPatterns>,
  procurementConfirmed: boolean,
  activeConfirmed: boolean,
  capabilityConfirmed: boolean,
  noHardDisqualifier: boolean,
  lifecycleStatus: string
) {
  return {
    procurementConfirmed,
    activeConfirmed,
    capabilityConfirmed,
    noHardDisqualifier,
    lifecycleStatus,
    profileVersion: OCCUMED_PROFILE_VERSION,
    relevance,
    historicalMatches,
    opportunityFitScore: result.rfpIntelligence?.fitScore,
    opportunityFitBand: result.rfpIntelligence?.fitBand,
  }
}

export function evaluateOccuMedResult(rawResult: ScrapedResult): OccuMedResultDecision {
  const result = rawResult as RfpDecisionCandidate
  const text = resultEvidenceText(result)
  const relevance = assessOccuMedRfpText(text)
  const historicalMatches = matchOccuMedHistoricalPatterns(text)
  const intelligence = result.rfpIntelligence
  const page = result.pageValidation
  const lifecycleStatus = page?.lifecycle.status || intelligence?.status || 'unknown'
  const procurementConfirmed = Boolean(
    (intelligence && intelligence.opportunityType !== 'unknown')
    || hasAffirmativeProcurementEvidence(text)
    || PROCUREMENT_DESTINATION.test(result.url)
    || (page?.finalUrl ? PROCUREMENT_DESTINATION.test(page.finalUrl) : false)
  )
  const activeConfirmed = ACTIVE_LIFECYCLE.has(lifecycleStatus)
  const structuredCapabilityFit = Boolean(
    intelligence
    && ['strong', 'good'].includes(intelligence.fitBand)
    && intelligence.matchedCapabilities.length > 0
  )
  const capabilityConfirmed = structuredCapabilityFit
    || relevance.status === 'relevant'
    || (relevance.status === 'uncertain' && relevance.matchedCapabilities.length > 0 && historicalMatches.length > 0)
  const noHardDisqualifier = relevance.exclusions.length === 0
  const common = decisionFields(
    result,
    relevance,
    historicalMatches,
    procurementConfirmed,
    activeConfirmed,
    capabilityConfirmed,
    noHardDisqualifier,
    lifecycleStatus
  )

  if (page && HARD_REJECT_AVAILABILITY.has(page.availability)) {
    return {
      decision: 'REJECT',
      reason: page.reason,
      ...common,
    }
  }

  if (FINAL_LIFECYCLE.has(lifecycleStatus)) {
    return {
      decision: 'REJECT',
      reason: page?.lifecycle.reason || `The opportunity is ${lifecycleStatus}.`,
      ...common,
    }
  }

  if (!procurementConfirmed) {
    return {
      decision: 'REJECT',
      reason: 'The destination and linked documents do not provide affirmative evidence of a real RFP, RFQ, solicitation, bid, tender, or comparable procurement notice.',
      ...common,
    }
  }

  // Hard exclusions are decisive even when a page incidentally contains medical
  // or occupational-health words. An EHR/software or pharmaceutical-product
  // procurement is not an Occu-Med opportunity merely because its package text
  // mentions examinations, clinics, vaccines, or other medical vocabulary.
  if (!noHardDisqualifier) {
    return {
      decision: 'REJECT',
      reason: relevance.exclusions.length
        ? `Outside Occu-Med's service model: ${relevance.exclusions.slice(0, 3).join(', ')}.`
        : relevance.reason,
      ...common,
    }
  }

  if (relevance.status === 'irrelevant' && !structuredCapabilityFit) {
    return {
      decision: 'REJECT',
      reason: relevance.reason,
      ...common,
    }
  }

  if (result.validation?.status === 'rejected') {
    return {
      decision: 'REJECT',
      reason: result.validation.reason,
      ...common,
    }
  }

  if (!page || REVIEW_AVAILABILITY.has(page.availability)) {
    return {
      decision: 'REVIEW',
      reason: page?.reason || 'The destination page could not be opened and independently verified.',
      ...common,
    }
  }

  if (!activeConfirmed) {
    return {
      decision: 'REVIEW',
      reason: page.lifecycle.reason || 'The response deadline and open status could not be confirmed.',
      ...common,
    }
  }

  if (!capabilityConfirmed || intelligence?.fitBand === 'review' || relevance.status === 'uncertain' || result.validation?.status === 'uncertain') {
    return {
      decision: 'REVIEW',
      reason: intelligence?.fitBand === 'review'
        ? `Structured fit score is ${intelligence.fitScore}/100 and requires pursuit review.`
        : relevance.status === 'uncertain'
          ? relevance.reason
          : (result.validation?.reason || 'Occu-Med capability fit requires review.'),
      ...common,
    }
  }

  const reason = intelligence
    ? `Confirmed active ${intelligence.opportunityType} with ${intelligence.fitBand} Occu-Med fit (${intelligence.fitScore}/100). ${relevance.reason}`
    : relevance.reason
  return {
    decision: 'SHOW',
    reason,
    ...common,
  }
}

type DecisionResult = ScrapedResult & {
  occuMedDecision: OccuMedResultDecision
  rfpIntelligence?: RfpOpportunityIntelligence
}

function annotateResult(result: ScrapedResult, decision: OccuMedResultDecision, bucket: ResultBucket): DecisionResult {
  const enriched = result as RfpDecisionCandidate
  const status = decision.decision === 'SHOW'
    ? 'valid' as const
    : decision.decision === 'REVIEW'
      ? 'uncertain' as const
      : 'rejected' as const
  const historicalConcepts = decision.historicalMatches.map(match => `${match.client}: ${match.program}`)
  const structuredCapabilities = enriched.rfpIntelligence?.matchedCapabilities || []
  const relevanceScore = Math.max(
    decision.relevance.score,
    (decision.opportunityFitScore || 0) / 100
  )

  return {
    ...result,
    bucket,
    validation: {
      status,
      relevance: relevanceScore,
      reason: `${decision.decision}: ${decision.reason}`,
      matchedConcepts: Array.from(new Set([
        ...(result.validation?.matchedConcepts || []),
        ...decision.relevance.matchedCapabilities,
        ...structuredCapabilities,
        ...historicalConcepts,
      ])),
      mode: result.validation?.mode || 'local-rules',
    },
    occuMedDecision: decision,
  }
}

function rejectionBucket(result: ScrapedResult, decision: OccuMedResultDecision): ResultBucket {
  if (result.pageValidation?.availability === 'dead' || decision.lifecycleStatus === 'dead') return 'dead'
  if (FINAL_LIFECYCLE.has(decision.lifecycleStatus) && !['dead', 'junk'].includes(decision.lifecycleStatus)) return 'expired'
  return 'rejected'
}

function uniqueByUrl(results: ScrapedResult[]): ScrapedResult[] {
  const seen = new Set<string>()
  return results.filter(result => {
    const key = result.url.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function rerank(results: ScrapedResult[]): ScrapedResult[] {
  return results
    .sort((left, right) => right.score - left.score)
    .map((result, index) => ({ ...result, rank: index + 1 }))
}

export function applyOccuMedDecisionGate(outcome: DeepValidationOutcome): OccuMedGatedOutcome {
  const buckets: SearchResultBuckets = {
    valid: [],
    uncertain: [],
    expired: [],
    dead: [],
    rejected: [],
    duplicate: [...outcome.buckets.duplicate],
  }
  const reasons: Record<string, number> = {}
  const sourceResults = uniqueByUrl([
    ...outcome.buckets.valid,
    ...outcome.buckets.uncertain,
    ...outcome.buckets.expired,
    ...outcome.buckets.dead,
    ...outcome.buckets.rejected,
  ])

  let show = 0
  let review = 0
  let reject = 0

  for (const result of sourceResults) {
    const decision = evaluateOccuMedResult(result)
    const reasonKey = decisionReasonKey(decision)
    reasons[reasonKey] = (reasons[reasonKey] || 0) + 1

    if (decision.decision === 'SHOW') {
      show += 1
      buckets.valid.push(annotateResult(result, decision, 'valid'))
      continue
    }

    if (decision.decision === 'REVIEW') {
      review += 1
      buckets.uncertain.push(annotateResult(result, decision, 'uncertain'))
      continue
    }

    reject += 1
    const bucket = rejectionBucket(result, decision)
    buckets[bucket].push(annotateResult(result, decision, bucket))
  }

  for (const bucket of Object.keys(buckets) as ResultBucket[]) {
    buckets[bucket] = rerank(buckets[bucket])
  }

  const progress: SearchValidationProgress = {
    ...outcome.progress,
    phase: 'complete',
    valid: buckets.valid.length,
    uncertain: buckets.uncertain.length,
    expired: buckets.expired.length,
    dead: buckets.dead.length,
    rejected: buckets.rejected.length,
    duplicates: buckets.duplicate.length,
  }

  return {
    ...outcome,
    // The normal result list is deliberately SHOW-only. REVIEW and REJECT
    // remain available in their evidence buckets but never appear as matches.
    results: buckets.valid,
    buckets,
    progress,
    diagnostics: {
      ...outcome.diagnostics,
      occuMedDecisionGate: {
        profileVersion: OCCUMED_PROFILE_VERSION,
        show,
        review,
        reject,
        reasons,
      },
    },
  }
}
