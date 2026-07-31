import test from 'node:test'
import assert from 'node:assert/strict'
import { applyOccuMedDecisionGate, evaluateOccuMedResult } from '../src/lib/occumed-result-decision'
import { extractRfpOpportunityIntelligence } from '../src/lib/rfp-opportunity-intelligence'
import type { DeepValidationOutcome } from '../src/lib/deep-validation'
import type { ResultStatusAssessment } from '../src/lib/result-status'
import type { ScrapedResult, SearchResultBuckets, SearchValidationProgress } from '../src/types/search'

function lifecycle(status: ResultStatusAssessment['status'], reason: string): ResultStatusAssessment {
  return { status, reason, confidence: 0.97, dates: [] }
}

function result(
  id: number,
  category: 'active' | 'irrelevant' | 'expired' | 'ambiguous'
): ScrapedResult {
  const variants = [
    'employment medical evaluations',
    'medical surveillance and respirator clearance',
    'firefighter NFPA 1582 examinations',
    'deployment medical readiness examinations',
    'fitness-for-duty and return-to-work evaluations',
    'audiograms, spirometry, laboratory testing, and vaccinations',
    'provider-network coordination for multi-location physicals',
    'medical records review and occupational-health program administration',
  ]
  const service = variants[id % variants.length]
  const buyer = ['City', 'County', 'Transit Authority', 'Fire District', 'Federal Contractor'][id % 5]
  const openLifecycle = lifecycle('open', 'The solicitation is accepting proposals and the response deadline is in the future.')
  const expiredLifecycle = lifecycle('expired', 'The latest response deadline has passed.')

  let text: string
  let assessment: ResultStatusAssessment
  let validationStatus: NonNullable<ScrapedResult['validation']>['status']

  if (category === 'active') {
    text = `RFP Number: ACTIVE-${id}. ${buyer} procurement for ${service}. The scope includes pre-employment medical evaluations, medical surveillance, audiograms, spirometry, laboratory testing, vaccinations, medical review, and provider-network coordination. Proposals are currently open. The contractor may coordinate services through a distributed provider network.`
    assessment = openLifecycle
    validationStatus = 'valid'
  } else if (category === 'irrelevant') {
    const excluded = [
      'medical equipment purchase',
      'electronic health record system',
      'health insurance benefits administration',
      'general nursing staffing',
      'hospital construction',
    ][id % 5]
    text = `RFP Number: WRONG-${id}. ${buyer} procurement for ${excluded}. This is a commodity or unrelated service purchase and contains no employment medical evaluation scope.`
    assessment = openLifecycle
    validationStatus = 'rejected'
  } else if (category === 'expired') {
    text = `RFP Number: EXPIRED-${id}. ${buyer} procurement for ${service}. The solicitation is closed and the proposal deadline has passed.`
    assessment = expiredLifecycle
    validationStatus = 'valid'
  } else {
    text = `RFP Number: REVIEW-${id}. ${buyer} procurement mentions occupational health, but the exact examination scope, delivery model, and mandatory qualifications are not provided.`
    assessment = openLifecycle
    validationStatus = 'uncertain'
  }

  const url = `https://buyer-${id}.example.gov/procurement/${category}-${id}`
  const intelligence = extractRfpOpportunityIntelligence({
    text,
    title: `${buyer} ${category} solicitation ${id}`,
    url,
    lifecycle: assessment,
  })

  return {
    title: intelligence.title,
    url,
    description: text,
    domain: `buyer-${id}.example.gov`,
    source: id % 2 ? 'Bing' : 'DuckDuckGo',
    rank: id + 1,
    score: 100 - id / 10,
    bucket: category === 'active' ? 'valid' : category === 'expired' ? 'expired' : category === 'ambiguous' ? 'uncertain' : 'rejected',
    validation: {
      status: validationStatus,
      relevance: category === 'active' ? 0.9 : category === 'ambiguous' ? 0.5 : 0.1,
      reason: category === 'active' ? 'Strong complete-query match.' : category === 'ambiguous' ? 'Scope requires review.' : 'Rejected benchmark example.',
      matchedConcepts: category === 'active' ? [service] : [],
      mode: 'local-rules',
    },
    pageValidation: {
      checkedAt: new Date().toISOString(),
      requestedUrl: url,
      finalUrl: url,
      httpStatus: 200,
      contentType: 'text/html',
      availability: 'reachable',
      reason: 'Synthetic benchmark page is reachable.',
      evidence: [text],
      extractedTextLength: text.length,
      cached: false,
      lifecycle: assessment,
    },
    rfpIntelligence: intelligence,
  } as ScrapedResult
}

function emptyProgress(): SearchValidationProgress {
  return {
    phase: 'complete',
    total: 300,
    checked: 300,
    reachable: 300,
    valid: 100,
    uncertain: 50,
    expired: 50,
    dead: 0,
    rejected: 100,
    duplicates: 0,
  }
}

function emptyBuckets(): SearchResultBuckets {
  return { valid: [], uncertain: [], expired: [], dead: [], rejected: [], duplicate: [] }
}

test('300-case benchmark keeps expired and irrelevant opportunities out of SHOW', () => {
  const active = Array.from({ length: 100 }, (_, index) => result(index, 'active'))
  const irrelevant = Array.from({ length: 100 }, (_, index) => result(100 + index, 'irrelevant'))
  const expired = Array.from({ length: 50 }, (_, index) => result(200 + index, 'expired'))
  const ambiguous = Array.from({ length: 50 }, (_, index) => result(250 + index, 'ambiguous'))

  const activeDecisions = active.map(evaluateOccuMedResult)
  const irrelevantDecisions = irrelevant.map(evaluateOccuMedResult)
  const expiredDecisions = expired.map(evaluateOccuMedResult)
  const ambiguousDecisions = ambiguous.map(evaluateOccuMedResult)

  const activeRecall = activeDecisions.filter(decision => decision.decision === 'SHOW').length / active.length
  const irrelevantLeakage = irrelevantDecisions.filter(decision => decision.decision === 'SHOW').length / irrelevant.length
  const expiredLeakage = expiredDecisions.filter(decision => decision.decision === 'SHOW').length / expired.length
  const ambiguousReviewRate = ambiguousDecisions.filter(decision => decision.decision === 'REVIEW').length / ambiguous.length

  assert.ok(activeRecall >= 0.85, `active recall was ${(activeRecall * 100).toFixed(1)}%`)
  assert.equal(irrelevantLeakage, 0)
  assert.equal(expiredLeakage, 0)
  assert.ok(ambiguousReviewRate >= 0.8, `ambiguous review rate was ${(ambiguousReviewRate * 100).toFixed(1)}%`)

  const buckets = emptyBuckets()
  buckets.valid = active
  buckets.rejected = irrelevant
  buckets.expired = expired
  buckets.uncertain = ambiguous
  const outcome: DeepValidationOutcome = {
    results: [...active, ...ambiguous],
    buckets,
    progress: emptyProgress(),
    diagnostics: {
      runtimeMs: 1,
      validationTargets: 300,
      pageCache: { active: 0, total: 0, ttlMs: 0 },
      smartFilter: {
        mode: 'local-rules',
        localModelEnabled: false,
        localModelUsed: false,
        externalConfigured: false,
        externalUsed: false,
        providerAttempts: [],
        candidateCount: 300,
        validCount: 100,
        uncertainCount: 50,
        rejectedCount: 150,
        displayedCount: 100,
        interpretation: 'benchmark',
        requiredConcepts: [],
      },
      duplicateCount: 0,
      adaptiveValidation: {
        candidatePool: 300,
        prioritizedCandidates: 300,
        waveSize: 12,
        wavesCompleted: 25,
        likelyShowTarget: 10,
        likelyShowCount: 100,
        stopReason: 'pool-exhausted',
      },
    },
  }

  const gated = applyOccuMedDecisionGate(outcome)
  assert.equal(gated.results.length, 100)
  assert.ok(gated.results.every(item => item.validation?.reason.startsWith('SHOW:')))
  assert.equal(gated.buckets.expired.length, 50)
  assert.equal(gated.buckets.rejected.length, 100)
  assert.equal(gated.buckets.uncertain.length, 50)
})
