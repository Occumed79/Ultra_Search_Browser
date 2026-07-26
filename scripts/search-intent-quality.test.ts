import test from 'node:test'
import assert from 'node:assert/strict'
import { applyIntentCandidateGate } from '../src/lib/search-intent-gate'
import { routeSearchLens } from '../src/lib/search-intent-routing'
import { verifiedSearchConfidence, verifiedSearchSummary } from '../src/app/api/search/validate/route'
import type { ScrapedResult } from '../src/types/search'

function result(title: string, url: string, description: string): ScrapedResult {
  return {
    title,
    url,
    description,
    domain: new URL(url).hostname.replace(/^www\./, ''),
    source: 'Bing',
    rank: 1,
    score: 50,
  }
}

test('RFP language automatically routes the default web lens to procurement', () => {
  const routed = routeSearchLens('web', undefined, 'Occupational Health Services RFP')
  assert.equal(routed.effectiveLens, 'procurement')
  assert.equal(routed.autoRouted, true)
  assert.match(routed.reason, /procurement opportunity/i)
})

test('an explicitly selected non-web lens is preserved', () => {
  const routed = routeSearchLens('provider', undefined, 'Occupational Health Services RFP')
  assert.equal(routed.effectiveLens, 'provider')
  assert.equal(routed.autoRouted, false)
})

test('procurement gate removes definitions, indexes, licensing pages, and unrelated health pages', () => {
  const candidates = [
    result(
      'A-Z Index: Occupational Outlook Handbook',
      'https://www.bls.gov/ooh/a-z-index.htm',
      'Occupational health and safety specialists and technicians.'
    ),
    result(
      'OCCUPATIONAL Definition & Meaning - Merriam-Webster',
      'https://www.merriam-webster.com/dictionary/occupational',
      'The meaning of occupational is of or relating to a job.'
    ),
    result(
      'Occupational Licensing - California DMV',
      'https://www.dmv.ca.gov/portal/vehicle-industry-services/occupational-licensing/',
      'Licensing information and applications.'
    ),
    result(
      'Request for Proposals: Occupational Health Services',
      'https://example.gov/procurement/occupational-health-rfp-2026.pdf',
      'The agency is accepting proposals for occupational health services. Responses are due August 28, 2026.'
    ),
  ]

  const gated = applyIntentCandidateGate('Occupational Health Services RFP', 'procurement', candidates)
  assert.equal(gated.results.length, 1)
  assert.equal(gated.results[0].title, 'Request for Proposals: Occupational Health Services')
  assert.equal(gated.diagnostics.rejected, 3)
  assert.ok((gated.diagnostics.reasons['generic-definition-or-index'] || 0) >= 2)
})

test('zero verified results produce zero confidence and an honest summary', () => {
  assert.equal(verifiedSearchConfidence([]), 0)
  assert.match(
    verifiedSearchSummary('Occupational Health Services RFP', 'procurement', []),
    /No destination page passed/i
  )
})

test('verified confidence is evidence-based and never claims 100 percent', () => {
  const verified: ScrapedResult = {
    ...result(
      'Request for Proposals: Occupational Health Services',
      'https://example.gov/procurement/occupational-health-rfp-2026.pdf',
      'Open request for proposals.'
    ),
    bucket: 'valid',
    validation: {
      status: 'valid',
      relevance: 0.91,
      reason: 'The page is a directly relevant RFP.',
      matchedConcepts: ['occupational', 'health', 'services', 'rfp'],
      mode: 'cerebras',
    },
    retrieval: {
      sources: ['Bing', 'DuckDuckGo'],
      queries: ['Occupational Health Services RFP'],
      purposes: ['broad'],
      overlap: 2,
    },
    pageValidation: {
      checkedAt: '2026-07-26T00:00:00.000Z',
      requestedUrl: 'https://example.gov/procurement/occupational-health-rfp-2026.pdf',
      finalUrl: 'https://example.gov/procurement/occupational-health-rfp-2026.pdf',
      httpStatus: 200,
      contentType: 'application/pdf',
      availability: 'reachable',
      reason: 'Reachable public document.',
      evidence: ['Responses are due August 28, 2026.', 'Occupational health services are required.'],
      extractedTextLength: 4000,
      cached: false,
      lifecycle: {
        status: 'open',
        reason: 'A future submission deadline is present.',
        confidence: 0.95,
        dates: [],
      },
    },
  }

  const confidence = verifiedSearchConfidence([verified])
  assert.ok(confidence > 60)
  assert.ok(confidence <= 96)
})
