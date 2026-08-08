import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalRetrievalUrl,
  distinctRetrievalCoverage,
  selectDirectRescueVariants,
  shouldRunDirectRescue,
} from '../src/lib/search-retrieval-coverage'

test('retrieval coverage collapses tracking variants of the same destination', () => {
  const results = [
    { url: 'https://www.example.gov/bids/26-104?utm_source=google' },
    { url: 'https://example.gov/bids/26-104?utm_source=bing#details' },
    { url: 'https://example.gov/bids/26-104/' },
    { url: 'https://example.gov/bids/26-105' },
  ]

  assert.equal(distinctRetrievalCoverage(results), 2)
  assert.equal(canonicalRetrievalUrl(results[0].url), 'https://example.gov/bids/26-104')
})

test('duplicate-heavy SearXNG output triggers direct rescue even when raw count is high', () => {
  assert.equal(shouldRunDirectRescue({
    uniqueCandidateCount: 3,
    successfulSearches: 8,
    attemptedSearches: 8,
  }), true)
})

test('broad unique coverage with enough successful variants does not waste rescue requests', () => {
  assert.equal(shouldRunDirectRescue({
    uniqueCandidateCount: 18,
    successfulSearches: 5,
    attemptedSearches: 8,
  }), false)
})

test('many results from only one search variant still trigger diversity rescue', () => {
  assert.equal(shouldRunDirectRescue({
    uniqueCandidateCount: 30,
    successfulSearches: 1,
    attemptedSearches: 8,
  }), true)
})

test('direct rescue spends its limited slots on complementary procurement strategies', () => {
  const variants = [
    { query: 'occupational health services', purpose: 'broad' },
    { query: '"occupational health services"', purpose: 'intent-core' },
    { query: 'buyer aliases rfp', purpose: 'ai-intent' },
    { query: 'site:.gov buyer aliases rfp', purpose: 'official' },
    { query: 'filetype:pdf buyer aliases rfp', purpose: 'document' },
    { query: 'buyer aliases 2026 active', purpose: 'freshness' },
    { query: 'site:bonfirehub.com buyer aliases', purpose: 'portal' },
  ]

  const selected = selectDirectRescueVariants(variants, 5)
  assert.deepEqual(selected.map(item => item.purpose), [
    'official',
    'document',
    'portal',
    'ai-intent',
    'freshness',
  ])
  assert.equal(selected.some(item => item.purpose === 'broad'), false)
})
