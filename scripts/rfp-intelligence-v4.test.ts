import test from 'node:test'
import assert from 'node:assert/strict'
import { extractRfpOpportunityIntelligence } from '../src/lib/rfp-opportunity-intelligence'
import { deduplicateSolicitations } from '../src/lib/solicitation-dedupe'
import { pursuitLearningAdjustment } from '../src/lib/result-feedback-ranking'
import type { ResultStatusAssessment } from '../src/lib/result-status'
import type { ScrapedResult } from '../src/types/search'

const openLifecycle: ResultStatusAssessment = {
  status: 'open',
  reason: 'Future response deadline found.',
  confidence: 0.96,
  dates: [{
    kind: 'due',
    value: 'August 30, 2026',
    iso: '2026-08-30T23:59:59.000Z',
    context: 'Proposals are due August 30, 2026.',
  }],
}

test('extracts structured active Occu-Med RFP intelligence', () => {
  const intelligence = extractRfpOpportunityIntelligence({
    url: 'https://example.gov/rfp/26-104',
    title: 'Employee Occupational Health Services',
    lifecycle: openLifecycle,
    documents: [
      { url: 'https://example.gov/rfp/26-104', kind: 'primary', extracted: true, textLength: 4000 },
      { url: 'https://example.gov/rfp/26-104-amendment.pdf', kind: 'amendment', extracted: true, textLength: 8000 },
    ],
    text: `
      Issuing agency: City of Example.
      RFP Number: 26-104.
      Proposals are due August 30, 2026.
      Questions due August 10, 2026.
      Place of performance: multiple locations throughout California.
      The contractor shall coordinate pre-employment physical examinations,
      fitness for duty evaluations, medical surveillance, audiograms,
      spirometry, drug testing, laboratory testing and vaccinations using a
      statewide provider network. The initial contract term is three years.
    `,
  })

  assert.equal(intelligence.solicitationNumber, '26-104')
  assert.equal(intelligence.dueDate, '2026-08-30')
  assert.equal(intelligence.deliveryModel, 'distributed-provider-network')
  assert.ok(intelligence.serviceSummary.length >= 4)
  assert.ok(intelligence.fitScore >= 68)
  assert.ok(['strong', 'good'].includes(intelligence.fitBand))
  assert.equal(intelligence.documentUrls.length, 2)
})

test('deduplicates separate URLs for one solicitation number', () => {
  const intelligence = extractRfpOpportunityIntelligence({
    url: 'https://example.gov/opportunity',
    title: 'Occupational Health Services',
    lifecycle: openLifecycle,
    text: 'RFP Number: 26-104. Occupational health medical surveillance. Proposals due August 30, 2026.',
  })
  const base: ScrapedResult = {
    title: 'Occupational Health Services',
    url: 'https://example.gov/opportunity',
    description: 'RFP 26-104',
    domain: 'example.gov',
    source: 'Bing',
    rank: 1,
    score: 80,
    validation: { status: 'valid', relevance: 0.9, reason: 'match', matchedConcepts: [], mode: 'local-rules' },
  }
  const outcome = deduplicateSolicitations([
    { ...base, rfpIntelligence: intelligence } as ScrapedResult,
    {
      ...base,
      url: 'https://example.gov/files/26-104.pdf',
      source: 'DuckDuckGo',
      score: 75,
      rfpIntelligence: { ...intelligence, documentUrls: ['https://example.gov/files/26-104.pdf'] },
    } as ScrapedResult,
  ])

  assert.equal(outcome.results.length, 1)
  assert.equal(outcome.duplicateCount, 1)
  assert.equal(outcome.results[0].entity?.confirmationCount, 2)
})

test('pursuit learning raises similar service patterns and lowers rejected patterns', () => {
  const result = {
    title: 'Firefighter occupational medical evaluations',
    url: 'https://example.gov/fire-medical',
    description: 'NFPA 1582 physicals and medical surveillance for public safety employees',
    domain: 'example.gov',
    source: 'Bing',
    rank: 1,
    score: 50,
  } satisfies ScrapedResult

  const positive = new Map([
    ['firefighter', 1.5],
    ['medical', 1.2],
    ['evaluations', 1.1],
    ['public', 0.8],
    ['safety', 0.8],
  ])
  const negative = new Map([
    ['firefighter', -1.5],
    ['medical', -1.2],
    ['evaluations', -1.1],
  ])

  assert.ok(pursuitLearningAdjustment(result, positive) > 0)
  assert.ok(pursuitLearningAdjustment(result, negative) < 0)
})
