import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buyerLanguageTermsForQuery,
  matchOccuMedCapabilityGroups,
} from '../src/lib/occumed-capability-matching'
import { applyOccuMedSmartFilter } from '../src/lib/occumed-smart-filter'
import { buildProcurementBrowserRescueTasks } from '../src/lib/procurement-browser-rescue-tasks'
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
    score: 60,
  }
}

test('pre-deployment searches expand to the full deployment-readiness buyer-language family', () => {
  const query = 'Pre-deployment health assessment'
  const terms = buyerLanguageTermsForQuery(query, 8)
  const firstFour = buildProcurementRescueQueries(
    query,
    buildDeterministicSemanticIntent(query, 'procurement')
  ).slice(0, 4).join(' ')

  assert.ok(matchOccuMedCapabilityGroups(query).some(group =>
    group.label === 'deployment and medical readiness'
  ))
  assert.ok(terms.some(term => /deployment medical|medical readiness|contractor medical clearance/i.test(term)))
  assert.match(firstFour, /deployment medical|medical readiness|contractor medical clearance/i)
})

test('occupational-health program management expands beyond the literal phrase', () => {
  const query = 'Occupational health program management'
  const terms = buyerLanguageTermsForQuery(query, 8)
  const firstFour = buildProcurementRescueQueries(
    query,
    buildDeterministicSemanticIntent(query, 'procurement')
  ).slice(0, 4).join(' ')

  assert.ok(terms.some(term => /occupational health|employee health|medical surveillance program management|medical review/i.test(term)))
  assert.match(firstFour, /occupational health|employee health|medical surveillance program management|medical review/i)
})

test('public indexes receive both literal and expanded buyer-language searches', () => {
  const queries = buildProcurementRescueQueries('Pre-deployment health assessment')
  const tasks = buildProcurementBrowserRescueTasks(queries)

  assert.equal(tasks.filter(task => task.source === 'bing').length, 4)
  assert.ok(tasks.some(task => task.source === 'duckduckgo' && task.query === queries[0]))
  assert.ok(tasks.some(task => task.source === 'mojeek' && task.query === queries[1]))
  assert.ok(tasks.some(task => task.source === 'brave' && task.query === queries[1]))
})

test('capability-family gate retains medical-readiness procurement wording', () => {
  const query = 'Pre-deployment health assessment'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const candidate = result(
    'Solicitation for Medical Readiness and Contractor Clearance Services',
    'https://procurement.example.gov/opportunities/readiness-26',
    'Request for proposals for deployment medical screening, medical readiness, and contractor medical clearance services.'
  )

  const gated = applyIntentCandidateGate(query, 'procurement', [candidate], intent)
  assert.deepEqual(gated.results.map(item => item.url), [candidate.url])
})

test('Occu-Med smart filter replaces literal fragments with the matched capability family', async () => {
  const query = 'Occupational health program management'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const candidate = result(
    'RFP for Employee Health and Medical Surveillance Administration',
    'https://procurement.example.gov/opportunities/employee-health-26',
    'Request for proposals for occupational health, employee health, medical surveillance program management, and provider network coordination.'
  )

  const filtered = await applyOccuMedSmartFilter(
    query,
    'procurement',
    [candidate],
    10,
    {
      semanticIntent: intent,
      useLocalTransformer: false,
      useExternalProviders: false,
    }
  )

  assert.deepEqual(filtered.results.map(item => item.url), [candidate.url])
  assert.equal(filtered.diagnostics.rejectedCount, 0)
})
