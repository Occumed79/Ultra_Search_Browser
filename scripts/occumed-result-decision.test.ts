import assert from 'node:assert/strict'
import test from 'node:test'
import type { DeepValidationOutcome } from '../src/lib/deep-validation'
import {
  applyOccuMedDecisionGate,
  evaluateOccuMedResult,
} from '../src/lib/occumed-result-decision'
import type { ScrapedResult } from '../src/types/search'

function candidate(overrides: Partial<ScrapedResult> = {}): ScrapedResult {
  return {
    title: 'Employee Occupational Health Services RFP',
    url: 'https://example.gov/procurement/employee-health-rfp',
    description: 'Request for proposals for pre-employment physicals, medical surveillance, audiograms, spirometry, and fitness-for-duty evaluations. Proposals are due December 31, 2099.',
    domain: 'example.gov',
    source: 'Bing',
    rank: 1,
    score: 0.9,
    validation: {
      status: 'valid',
      relevance: 0.9,
      reason: 'Complete-query evidence matched.',
      matchedConcepts: ['occupational health'],
      mode: 'cerebras',
    },
    pageValidation: {
      checkedAt: new Date().toISOString(),
      requestedUrl: 'https://example.gov/procurement/employee-health-rfp',
      finalUrl: 'https://example.gov/procurement/employee-health-rfp',
      httpStatus: 200,
      contentType: 'text/html',
      availability: 'reachable',
      reason: 'The destination is reachable and contains substantive public content.',
      evidence: [
        'Request for proposals for occupational health services.',
        'Proposals are due December 31, 2099.',
      ],
      extractedTextLength: 2000,
      cached: false,
      lifecycle: {
        status: 'open',
        reason: 'The latest extracted deadline 2099-12-31 is still in the future.',
        confidence: 0.96,
        dates: [{
          kind: 'due',
          value: 'December 31, 2099',
          iso: '2099-12-31T23:59:59.000Z',
          context: 'Proposals are due December 31, 2099.',
        }],
      },
    },
    ...overrides,
  }
}

function outcome(results: ScrapedResult[]): DeepValidationOutcome {
  return {
    results,
    buckets: {
      valid: results,
      uncertain: [],
      expired: [],
      dead: [],
      rejected: [],
      duplicate: [],
    },
    progress: {
      phase: 'complete',
      total: results.length,
      checked: results.length,
      reachable: results.length,
      valid: results.length,
      uncertain: 0,
      expired: 0,
      dead: 0,
      rejected: 0,
      duplicates: 0,
    },
    diagnostics: {
      runtimeMs: 5,
      validationTargets: results.length,
      pageCache: { active: 0, total: 0, ttlMs: 600000 },
      smartFilter: {
        mode: 'cerebras',
        localModelEnabled: true,
        localModelUsed: true,
        externalConfigured: true,
        externalUsed: true,
        providerAttempts: [],
        candidateCount: results.length,
        validCount: results.length,
        uncertainCount: 0,
        rejectedCount: 0,
        displayedCount: results.length,
        interpretation: 'Find active Occu-Med-fit RFPs.',
        requiredConcepts: ['procurement', 'Occu-Med capable service'],
      },
      duplicateCount: 0,
    },
  }
}

test('SHOW requires a real, open, Occu-Med-relevant procurement opportunity', () => {
  const decision = evaluateOccuMedResult(candidate())
  assert.equal(decision.decision, 'SHOW')
  assert.equal(decision.procurementConfirmed, true)
  assert.equal(decision.activeConfirmed, true)
  assert.equal(decision.capabilityConfirmed, true)
})

test('expired opportunities are rejected even when the service matches Occu-Med', () => {
  const result = candidate({
    pageValidation: {
      ...candidate().pageValidation!,
      lifecycle: {
        status: 'expired',
        reason: 'The latest extracted deadline 2025-01-01 has passed.',
        confidence: 0.99,
        dates: [{
          kind: 'due',
          value: 'January 1, 2025',
          iso: '2025-01-01T23:59:59.000Z',
          context: 'Proposals were due January 1, 2025.',
        }],
      },
    },
  })
  assert.equal(evaluateOccuMedResult(result).decision, 'REJECT')
})

test('unrelated software procurement is rejected', () => {
  const result = candidate({
    title: 'Electronic Health Record Software RFP',
    description: 'Request for proposals to purchase and implement an electronic health record information technology system.',
    pageValidation: {
      ...candidate().pageValidation!,
      evidence: ['Request for proposals for an electronic health record software implementation.'],
    },
  })
  const decision = evaluateOccuMedResult(result)
  assert.equal(decision.decision, 'REJECT')
  assert.equal(decision.capabilityConfirmed, false)
})

test('blocked but potentially relevant pages go to REVIEW, never the primary list', () => {
  const result = candidate({
    pageValidation: {
      ...candidate().pageValidation!,
      availability: 'blocked',
      reason: 'The destination returned a bot challenge.',
      lifecycle: {
        status: 'unknown',
        reason: 'Open status could not be confirmed.',
        confidence: 0.2,
        dates: [],
      },
    },
  })
  assert.equal(evaluateOccuMedResult(result).decision, 'REVIEW')
})

test('the mandatory gate returns only SHOW decisions as primary results', () => {
  const open = candidate()
  const expired = candidate({
    url: 'https://example.gov/procurement/expired-rfp',
    pageValidation: {
      ...candidate().pageValidation!,
      requestedUrl: 'https://example.gov/procurement/expired-rfp',
      finalUrl: 'https://example.gov/procurement/expired-rfp',
      lifecycle: {
        status: 'closed',
        reason: 'Submissions are closed.',
        confidence: 0.99,
        dates: [],
      },
    },
  })
  const unrelated = candidate({
    url: 'https://example.gov/procurement/ehr-rfp',
    title: 'EHR Software RFP',
    description: 'Request for proposals for electronic health record software.',
    pageValidation: {
      ...candidate().pageValidation!,
      requestedUrl: 'https://example.gov/procurement/ehr-rfp',
      finalUrl: 'https://example.gov/procurement/ehr-rfp',
      evidence: ['Request for proposals for electronic health record software.'],
    },
  })

  const gated = applyOccuMedDecisionGate(outcome([open, expired, unrelated]))
  assert.equal(gated.results.length, 1)
  assert.equal(gated.results[0].url, open.url)
  assert.equal(gated.buckets.expired.length, 1)
  assert.equal(gated.buckets.rejected.length, 1)
  assert.equal(gated.diagnostics.occuMedDecisionGate.show, 1)
  assert.equal(gated.diagnostics.occuMedDecisionGate.reject, 2)
})
