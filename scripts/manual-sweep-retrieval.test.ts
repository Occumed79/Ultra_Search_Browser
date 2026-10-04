import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { profileRows } from './fixtures/canonical-profile'
import { buildProfile, setRelevanceProfile } from '../src/lib/canonical/search/relevanceProfile'
import {
  canonicalSearchBundleTerms,
  canonicalSearchPriorityAgencies,
  canonicalTargetBuyerTypes,
} from '../src/lib/canonical-relevance'
import { buildProcurementRescueQueries } from '../src/lib/procurement-rescue-queries'
import { buildBrowserSearchPlan } from '../src/lib/browser-search-pipeline'

afterEach(() => setRelevanceProfile(null))

function publishSweepProfile() {
  const rows = profileRows('quasar inspection')
  rows.facts.push(
    {
      fact_key: 'test.bundle',
      category: 'rfp_search_bundle',
      predicate: 'synthetic_sweep',
      value_text: 'Synthetic sweep',
      value_json: {
        service_terms: ['"quasar inspection"', '"violet assessment"'],
        workforce_terms: [],
        procurement_terms: ['RFP', 'solicitation'],
        exclusions: [],
      },
      value_numeric: null,
    },
    {
      fact_key: 'test.buyers',
      category: 'target_buyer_type',
      predicate: 'all',
      value_text: null,
      value_json: ['Sample municipalities', 'Sample public authorities'],
      value_numeric: null,
    },
    {
      fact_key: 'test.agencies',
      category: 'target_agency',
      predicate: 'search_priority_terms',
      value_text: null,
      value_json: { terms: ['sample agency'], relevance_effect: 'none' },
      value_numeric: null,
    }
  )
  assert.equal(setRelevanceProfile(buildProfile(rows, 'neon')).applied, true)
}

test('manual sweep expansion is driven by canonical Neon facts', () => {
  publishSweepProfile()
  assert.ok(canonicalSearchBundleTerms('quasar inspection RFP').includes('violet assessment'))
  assert.deepEqual(canonicalTargetBuyerTypes(), ['Sample municipalities', 'Sample public authorities'])
  assert.deepEqual(canonicalSearchPriorityAgencies(), ['sample agency'])

  const queries = buildProcurementRescueQueries('quasar inspection RFP')
  assert.ok(queries.some(query => query.includes('violet assessment')))
  assert.ok(queries.some(query => query.includes('Sample municipalities')))
  assert.ok(queries.some(query => query.includes('sample agency')))
  assert.ok(queries.some(query => /site:\.gov/i.test(query)))
  assert.ok(queries.some(query => /filetype:pdf/i.test(query)))
})

test('browser plan keeps twelve diversified retrieval strategies without changing relevance authority', () => {
  publishSweepProfile()
  const plan = buildBrowserSearchPlan('quasar inspection RFP', 12)
  assert.equal(plan.searches.length, 12)
  assert.ok(plan.searches.some(search => search.query.includes('violet assessment')))
  assert.ok(plan.searches.some(search => search.purpose === 'official'))
  assert.ok(plan.searches.some(search => search.purpose === 'document'))
  assert.ok(plan.searches.some(search => search.purpose === 'freshness'))
  assert.ok(plan.searches.some(search => search.purpose === 'portal'))
})
