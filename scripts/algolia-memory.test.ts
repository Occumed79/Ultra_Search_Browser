import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  indexVerifiedResultsInAlgolia,
  isAlgoliaSearchConfigured,
  isAlgoliaWriteConfigured,
  searchAlgoliaMemory,
} from '../src/lib/algolia'
import type { ScrapedResult } from '../src/types/search'

const originalFetch = globalThis.fetch
const originalAppId = process.env.ALGOLIA_APP_ID
const originalIndex = process.env.ALGOLIA_INDEX_NAME
const originalSearchKey = process.env.ALGOLIA_SEARCH_API_KEY
const originalWriteKey = process.env.ALGOLIA_WRITE_API_KEY

function restoreEnvironment() {
  globalThis.fetch = originalFetch
  if (originalAppId === undefined) delete process.env.ALGOLIA_APP_ID
  else process.env.ALGOLIA_APP_ID = originalAppId
  if (originalIndex === undefined) delete process.env.ALGOLIA_INDEX_NAME
  else process.env.ALGOLIA_INDEX_NAME = originalIndex
  if (originalSearchKey === undefined) delete process.env.ALGOLIA_SEARCH_API_KEY
  else process.env.ALGOLIA_SEARCH_API_KEY = originalSearchKey
  if (originalWriteKey === undefined) delete process.env.ALGOLIA_WRITE_API_KEY
  else process.env.ALGOLIA_WRITE_API_KEY = originalWriteKey
}

afterEach(restoreEnvironment)

test('Algolia memory remains optional until app id and search key are configured', async () => {
  delete process.env.ALGOLIA_APP_ID
  delete process.env.ALGOLIA_SEARCH_API_KEY
  process.env.ALGOLIA_INDEX_NAME = 'ultra_search_procurement'

  assert.equal(isAlgoliaSearchConfigured(), false)
  const response = await searchAlgoliaMemory('occupational health RFP')
  assert.equal(response.configured, false)
  assert.equal(response.ok, false)
  assert.deepEqual(response.results, [])
  assert.match(response.error || '', /ALGOLIA_APP_ID/i)
})

test('Algolia search uses the search key and normalizes verified-memory hits', async () => {
  process.env.ALGOLIA_APP_ID = 'TESTAPP123'
  process.env.ALGOLIA_INDEX_NAME = 'ultra_search_procurement'
  process.env.ALGOLIA_SEARCH_API_KEY = 'search-key'

  let requestedUrl = ''
  let requestInit: RequestInit | undefined
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input)
    requestInit = init
    return new Response(JSON.stringify({
      hits: [
        {
          objectID: 'abc123',
          title: 'Occupational Health Services RFP',
          url: 'https://example.gov/rfp/123#details',
          description: 'Active procurement for employee medical evaluations.',
          domain: 'example.gov',
          score: 88,
        },
        {
          objectID: 'unsafe',
          title: 'Bad row',
          url: 'javascript:alert(1)',
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const response = await searchAlgoliaMemory('occupational health services', { maxResults: 10 })

  assert.equal(isAlgoliaSearchConfigured(), true)
  assert.equal(requestedUrl, 'https://TESTAPP123-dsn.algolia.net/1/indexes/ultra_search_procurement/query')
  assert.equal(requestInit?.method, 'POST')
  const headers = new Headers(requestInit?.headers)
  assert.equal(headers.get('X-Algolia-Application-Id'), 'TESTAPP123')
  assert.equal(headers.get('X-Algolia-API-Key'), 'search-key')
  const body = JSON.parse(String(requestInit?.body))
  assert.equal(body.query, 'occupational health services')
  assert.equal(body.hitsPerPage, 10)
  assert.equal(response.ok, true)
  assert.equal(response.results.length, 1)
  assert.equal(response.results[0].source, 'Algolia memory')
  assert.equal(response.results[0].domain, 'example.gov')
  assert.equal(response.results[0].url, 'https://example.gov/rfp/123')
})

test('Algolia write batches deterministic verified-opportunity records with the write key', async () => {
  process.env.ALGOLIA_APP_ID = 'TESTAPP123'
  process.env.ALGOLIA_INDEX_NAME = 'ultra_search_procurement'
  process.env.ALGOLIA_WRITE_API_KEY = 'write-key'

  let requestedUrl = ''
  let requestInit: RequestInit | undefined
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input)
    requestInit = init
    return new Response(JSON.stringify({ taskID: 42 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const result: ScrapedResult = {
    title: 'Employee Medical Evaluation Solicitation',
    url: 'https://example.gov/opportunity/456',
    description: 'Open solicitation for pre-employment medical evaluations.',
    domain: 'example.gov',
    source: 'SearXNG · google',
    rank: 1,
    score: 95,
    bucket: 'valid',
    validation: {
      status: 'valid',
      relevance: 95,
      reason: 'Matches Occu-Med capability and procurement intent.',
      matchedConcepts: ['employment medical evaluation'],
      mode: 'local-rules',
    },
    pageValidation: {
      checkedAt: '2026-08-22T20:00:00.000Z',
      requestedUrl: 'https://example.gov/opportunity/456',
      finalUrl: 'https://example.gov/opportunity/456',
      availability: 'reachable',
      reason: 'Reachable procurement page',
      evidence: ['Responses due September 30, 2026'],
      extractedTextLength: 500,
      cached: false,
      lifecycle: {
        status: 'open',
        reason: 'Future response deadline',
        confidence: 0.95,
        dates: [],
      },
    },
  }

  const response = await indexVerifiedResultsInAlgolia([result], 'procurement', 10)

  assert.equal(isAlgoliaWriteConfigured(), true)
  assert.equal(requestedUrl, 'https://TESTAPP123.algolia.net/1/indexes/ultra_search_procurement/batch')
  assert.equal(requestInit?.method, 'POST')
  const headers = new Headers(requestInit?.headers)
  assert.equal(headers.get('X-Algolia-API-Key'), 'write-key')
  const body = JSON.parse(String(requestInit?.body))
  assert.equal(body.requests.length, 1)
  assert.equal(body.requests[0].action, 'updateObject')
  assert.equal(body.requests[0].body.url, 'https://example.gov/opportunity/456')
  assert.equal(body.requests[0].body.lifecycleStatus, 'open')
  assert.equal(typeof body.requests[0].body.objectID, 'string')
  assert.equal(body.requests[0].body.objectID.length, 32)
  assert.deepEqual(body.requests[0].body.matchedConcepts, ['employment medical evaluation'])
  assert.equal(response.indexed, 1)
  assert.equal(response.failed, 0)
  assert.equal(response.taskId, 42)
})
