import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBrowserSearchPlan,
  normalizeBrowserSerpCandidates,
} from '../src/lib/browser-search-pipeline'

test('browser search plan is deterministic, procurement-focused, and requires no API key', () => {
  const plan = buildBrowserSearchPlan('Occupational Health Services RFP')

  assert.equal(plan.lens, 'procurement')
  assert.equal(plan.transport, 'browser-extension')
  assert.equal(plan.apiKeysRequired, false)
  assert.equal(plan.intent.provider, 'deterministic')
  assert.equal(plan.intent.usedExternal, false)
  assert.ok(plan.searches.length >= 4)
  assert.doesNotMatch(plan.searches[0].query, /\b(?:site:|filetype:)/i)
  assert.ok(plan.searches.some(search => /site:\.gov/i.test(search.query)))
  assert.ok(plan.searches.some(search => /filetype:pdf/i.test(search.query)))
})

test('browser SERP ingestion normalizes tracking URLs and merges duplicate evidence', () => {
  const results = normalizeBrowserSerpCandidates([
    {
      title: 'Occupational Health Services RFP',
      url: 'https://county.example.gov/bids/occupational-health?utm_source=google#top',
      description: 'Request for proposals for employee occupational health services.',
      source: 'Browser · Google',
      rank: 1,
      query: 'occupational health services RFP',
      purpose: 'broad',
    },
    {
      title: 'Occupational Health Services Request for Proposals',
      url: 'https://county.example.gov/bids/occupational-health',
      description: 'Request for proposals for employee occupational health services. Responses due September 30, 2026.',
      source: 'Browser · Bing',
      rank: 2,
      query: 'site:.gov occupational health services RFP',
      purpose: 'official',
    },
    {
      title: 'Invalid',
      url: 'javascript:alert(1)',
      source: 'Browser · Google',
    },
  ])

  assert.equal(results.length, 1)
  assert.equal(results[0].url, 'https://county.example.gov/bids/occupational-health')
  assert.equal(results[0].retrieval?.overlap, 2)
  assert.deepEqual(results[0].retrieval?.sources.sort(), ['Browser · Bing', 'Browser · Google'])
  assert.match(results[0].description, /Responses due September 30, 2026/i)
})
