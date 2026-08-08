import test from 'node:test'
import assert from 'node:assert/strict'
import { applyIntentCandidateGate } from '../src/lib/search-intent-gate'
import { buildDeterministicSemanticIntent } from '../src/lib/semantic-intent'
import type { ScrapedResult } from '../src/types/search'

function candidate(overrides: Partial<ScrapedResult>): ScrapedResult {
  return {
    title: 'Occupational Medicine Services | Employment Health Services',
    url: 'https://clinic.example.com/occupational-health',
    description: 'Employer physicals, occupational medicine, testing, and employee health services.',
    domain: 'clinic.example.com',
    source: 'SearXNG · google cse',
    rank: 1,
    score: 80,
    retrieval: {
      sources: ['SearXNG · google cse'],
      queries: ['occupational health services RFP RFQ solicitation bid tender'],
      purposes: ['ai-intent'],
      overlap: 1,
    },
    ...overrides,
  }
}

test('an ordinary clinic page is not procurement merely because an RFP-targeted search returned it', () => {
  const query = 'occupational health services'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const result = candidate({})

  const gated = applyIntentCandidateGate(query, 'procurement', [result], intent)

  assert.equal(gated.results.length, 0)
  assert.equal(gated.diagnostics.reasons['missing-procurement-evidence'], 1)
})

test('a sparse procurement destination may use targeted-query provenance to reach deep validation', () => {
  const query = 'employee medical examinations'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const result = candidate({
    title: 'Employee Medical Examination Services',
    url: 'https://county.gov/procurement/opportunities/26-114',
    domain: 'county.gov',
    description: 'Employee medical examination services and related occupational health requirements.',
    retrieval: {
      sources: ['SearXNG · google cse'],
      queries: ['employee medical examinations RFP RFQ solicitation bid tender'],
      purposes: ['ai-intent'],
      overlap: 1,
    },
  })

  const gated = applyIntentCandidateGate(query, 'procurement', [result], intent)

  assert.deepEqual(gated.results.map(item => item.url), [result.url])
  assert.equal(gated.diagnostics.rejected, 0)
})
