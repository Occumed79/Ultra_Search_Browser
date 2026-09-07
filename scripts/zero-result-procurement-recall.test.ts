import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBrowserSearchPlan } from '../src/lib/browser-search-pipeline'
import { applyIntentCandidateGate } from '../src/lib/search-intent-gate'
import { applyOccuMedSmartFilter } from '../src/lib/occumed-smart-filter'
import { buildDeterministicSemanticIntent } from '../src/lib/semantic-intent'
import type { ScrapedResult } from '../src/types/search'

function sparseTargetedCandidate(query: string): ScrapedResult {
  return {
    title: 'Employee Occupational Health Medical Surveillance Examinations',
    url: 'https://supplier.example.com/public/event/7f5c2a91',
    description: 'Employee medical surveillance examinations, audiometry, spirometry, respirator evaluations, and occupational health testing.',
    domain: 'supplier.example.com',
    source: 'Exa',
    rank: 1,
    score: 88,
    retrieval: {
      sources: ['Exa'],
      queries: [`${query} RFP RFQ solicitation tender 2026`],
      purposes: ['ai-intent'],
      overlap: 1,
    },
  }
}

for (const query of [
  'occupational health exams',
  'occupational health medical surveillance exams',
]) {
  test(`broad procurement plan sends a procurement-bearing variant first for ${query}`, () => {
    const plan = buildBrowserSearchPlan(query, 8)
    assert.equal(plan.searches[0].purpose, 'ai-intent')
    assert.match(plan.searches[0].query, /\b(?:RFP|RFQ|solicitation|tender)\b/i)
    assert.ok(plan.searches.some(search => search.purpose === 'broad'))
    assert.ok(plan.searches.some(search => search.purpose === 'official'))
    assert.ok(plan.searches.some(search => search.purpose === 'document'))
  })

  test(`sparse targeted procurement evidence survives candidate filtering for ${query}`, async () => {
    const intent = buildDeterministicSemanticIntent(query, 'procurement')
    const candidate = sparseTargetedCandidate(query)
    const gated = applyIntentCandidateGate(query, 'procurement', [candidate], intent)

    assert.deepEqual(gated.results.map(result => result.url), [candidate.url])
    assert.equal(gated.diagnostics.rejected, 0)

    const filtered = await applyOccuMedSmartFilter(query, 'procurement', gated.results, 40, {
      useLocalTransformer: false,
      useExternalProviders: false,
      semanticIntent: intent,
    })

    assert.ok(filtered.results.length > 0)
    assert.notEqual(filtered.results[0].validation?.status, 'rejected')
  })
}

test('SAM opaque opportunity URLs count as procurement destinations even with sparse snippets', () => {
  const query = 'occupational health exams'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const candidate: ScrapedResult = {
    title: 'Employee Occupational Health Examinations',
    url: 'https://sam.gov/opp/46f1a7b0e49d4be4a8e3b65d62591d92/view',
    description: 'Periodic employee examinations, surveillance testing, audiometry, and spirometry.',
    domain: 'sam.gov',
    source: 'SearXNG · google',
    rank: 1,
    score: 90,
    retrieval: {
      sources: ['SearXNG · google'],
      queries: ['site:sam.gov occupational health exams opportunities'],
      purposes: ['portal'],
      overlap: 1,
    },
  }

  const gated = applyIntentCandidateGate(query, 'procurement', [candidate], intent)
  assert.equal(gated.results.length, 1)
})
