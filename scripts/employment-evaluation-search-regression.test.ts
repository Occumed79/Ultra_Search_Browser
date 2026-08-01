import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProcurementRescueQueries } from '../src/lib/procurement-rescue-queries'
import { applyIntentCandidateGate } from '../src/lib/search-intent-gate'
import { buildDeterministicSemanticIntent } from '../src/lib/semantic-intent'
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

test('plural employment evaluations searches use buyer-language aliases inside the browser budget', () => {
  const query = 'employment evaluations'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const firstBrowserQueries = buildProcurementRescueQueries(query, intent).slice(0, 4)

  assert.ok(firstBrowserQueries.some(rescueQuery =>
    /occupational health|employee health|employment medical evaluation|employment physical|pre-employment physical/i.test(rescueQuery)
  ))
})

test('plural employment evaluations retains occupational-health procurement candidates', () => {
  const query = 'employment evaluations'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const candidate = result(
    'RFP 26-114 Occupational Health and Pre-Employment Physical Services',
    'https://procurement.example.gov/opportunities/26-114',
    'The County requests proposals for employee health, pre-employment physical examinations, fitness-for-duty evaluations, and medical surveillance services.'
  )

  const gated = applyIntentCandidateGate(query, 'procurement', [candidate], intent)

  assert.deepEqual(gated.results.map(item => item.url), [candidate.url])
  assert.equal(gated.diagnostics.rejected, 0)
})
