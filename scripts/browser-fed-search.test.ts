import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBrowserSearchPlan,
  normalizeBrowserSerpCandidates,
} from '../src/lib/browser-search-pipeline'
import { SEARXNG_WEB_ENGINES } from '../src/lib/searxng-engines'
import { resolveSearxngBase, searchSearXNG } from '../src/lib/searxng'

test('zero-key search plan is deterministic, procurement-focused, and server transported', () => {
  const plan = buildBrowserSearchPlan('Occupational Health Services RFP')

  assert.equal(plan.lens, 'procurement')
  assert.equal(plan.transport, 'searxng')
  assert.equal(plan.apiKeysRequired, false)
  assert.equal(plan.intent.provider, 'deterministic')
  assert.equal(plan.intent.usedExternal, false)
  assert.ok(plan.searches.length >= 4)
  assert.doesNotMatch(plan.searches[0].query, /\b(?:site:|filetype:)/i)
  assert.ok(plan.searches.some(search => /site:\.gov/i.test(search.query)))
  assert.ok(plan.searches.some(search => /filetype:pdf/i.test(search.query)))
})

test('SearXNG ensemble contains broad independent web engines including the live Google CSE default', () => {
  assert.ok(SEARXNG_WEB_ENGINES.includes('google cse'))
  assert.ok(SEARXNG_WEB_ENGINES.includes('brave'))
  assert.ok(SEARXNG_WEB_ENGINES.includes('duckduckgo'))
  assert.ok(SEARXNG_WEB_ENGINES.includes('startpage'))
  assert.ok(SEARXNG_WEB_ENGINES.includes('bing'))
  assert.ok(SEARXNG_WEB_ENGINES.includes('qwant'))
  assert.ok(SEARXNG_WEB_ENGINES.includes('mojeek'))
  assert.ok(SEARXNG_WEB_ENGINES.includes('yahoo'))
})

test('SearXNG base URL preserves a deployment path prefix', () => {
  const original = process.env.SEARXNG_URL
  try {
    process.env.SEARXNG_URL = 'https://search.example.test/internal/searx/'
    assert.equal(resolveSearxngBase(), 'https://search.example.test/internal/searx')
  } finally {
    if (original === undefined) delete process.env.SEARXNG_URL
    else process.env.SEARXNG_URL = original
  }
})

test('SearXNG drops unsafe/invalid URLs before applying maxResults', async () => {
  const originalUrl = process.env.SEARXNG_URL
  const originalFetch = globalThis.fetch
  try {
    process.env.SEARXNG_URL = 'https://search.example.test'
    globalThis.fetch = async () => new Response(JSON.stringify({
      results: [
        { title: 'Unsafe', url: 'javascript:alert(1)', content: 'ignore', engine: 'brave' },
        { title: '', url: 'https://example.test/missing-title', content: 'ignore', engine: 'bing' },
        { title: 'Valid one', url: 'https://one.example.test/rfp', content: 'RFP one', engine: 'brave' },
        { title: 'Valid two', url: 'https://two.example.test/rfp', content: 'RFP two', engine: 'bing' },
        { title: 'Valid three', url: 'https://three.example.test/rfp', content: 'RFP three', engine: 'qwant' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await searchSearXNG('occupational health RFP', { maxResults: 2 })
    assert.equal(response.ok, true)
    assert.equal(response.results.length, 2)
    assert.deepEqual(response.results.map(result => result.title), ['Valid one', 'Valid two'])
    assert.ok(response.results.every(result => /^https:\/\//.test(result.url)))
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SEARXNG_URL
    else process.env.SEARXNG_URL = originalUrl
  }
})

test('metasearch candidate ingestion normalizes tracking URLs and merges duplicate evidence', () => {
  const results = normalizeBrowserSerpCandidates([
    {
      title: 'Occupational Health Services RFP',
      url: 'https://county.example.gov/bids/occupational-health?utm_source=brave#top',
      description: 'Request for proposals for employee occupational health services.',
      source: 'SearXNG · brave',
      rank: 1,
      query: 'occupational health services RFP',
      purpose: 'broad',
    },
    {
      title: 'Occupational Health Services Request for Proposals',
      url: 'https://county.example.gov/bids/occupational-health',
      description: 'Request for proposals for employee occupational health services. Responses due September 30, 2026.',
      source: 'SearXNG · bing',
      rank: 2,
      query: 'site:.gov occupational health services RFP',
      purpose: 'official',
    },
    {
      title: 'Invalid',
      url: 'javascript:alert(1)',
      source: 'SearXNG · brave',
    },
  ])

  assert.equal(results.length, 1)
  assert.equal(results[0].url, 'https://county.example.gov/bids/occupational-health')
  assert.equal(results[0].retrieval?.overlap, 2)
  assert.deepEqual(results[0].retrieval?.sources.sort(), ['SearXNG · bing', 'SearXNG · brave'])
  assert.match(results[0].description, /Responses due September 30, 2026/i)
})
