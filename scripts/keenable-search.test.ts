import test from 'node:test'
import assert from 'node:assert/strict'
import { isKeenableConfigured, searchKeenable } from '../src/lib/keenable'

const originalFetch = globalThis.fetch
const originalKey = process.env.KEENABLE_API_KEY
const originalBase = process.env.KEENABLE_API_BASE_URL
const originalMode = process.env.KEENABLE_SEARCH_MODE

function restoreEnvironment() {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.KEENABLE_API_KEY
  else process.env.KEENABLE_API_KEY = originalKey
  if (originalBase === undefined) delete process.env.KEENABLE_API_BASE_URL
  else process.env.KEENABLE_API_BASE_URL = originalBase
  if (originalMode === undefined) delete process.env.KEENABLE_SEARCH_MODE
  else process.env.KEENABLE_SEARCH_MODE = originalMode
}

test.afterEach(restoreEnvironment)

test('Keenable is optional when no API key is configured', async () => {
  delete process.env.KEENABLE_API_KEY
  assert.equal(isKeenableConfigured(), false)

  const response = await searchKeenable('occupational health RFP')
  assert.equal(response.configured, false)
  assert.equal(response.ok, false)
  assert.deepEqual(response.results, [])
  assert.match(response.error || '', /KEENABLE_API_KEY/i)
})

test('Keenable sends the API key, pro mode, and normalizes web results', async () => {
  process.env.KEENABLE_API_KEY = 'test-key'
  delete process.env.KEENABLE_API_BASE_URL
  delete process.env.KEENABLE_SEARCH_MODE

  let requestedUrl = ''
  let requestInit: RequestInit | undefined
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input)
    requestInit = init
    return new Response(JSON.stringify({
      results: [
        {
          title: 'Occupational Health Services RFP',
          url: 'https://example.gov/procurement/rfp-123?utm_source=test#details',
          snippet: '<p>Responses due September 30, 2026.</p>',
        },
        {
          title: 'Invalid URL row',
          url: 'javascript:alert(1)',
          snippet: 'reject me',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const response = await searchKeenable('occupational health services RFP', { maxResults: 10 })

  assert.equal(isKeenableConfigured(), true)
  assert.equal(requestedUrl, 'https://api.keenable.ai/v1/search')
  assert.equal(requestInit?.method, 'POST')
  assert.equal(new Headers(requestInit?.headers).get('X-API-Key'), 'test-key')
  assert.equal(new Headers(requestInit?.headers).get('X-Keenable-Title'), 'Ultra Search Browser')
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    query: 'occupational health services RFP',
    mode: 'pro',
  })
  assert.equal(response.configured, true)
  assert.equal(response.ok, true)
  assert.equal(response.results.length, 1)
  assert.equal(response.results[0].source, 'Keenable')
  assert.equal(response.results[0].domain, 'example.gov')
  assert.equal(response.results[0].title, 'Occupational Health Services RFP')
  assert.equal(response.results[0].description, 'Responses due September 30, 2026.')
})

test('Keenable HTTP failures fail open with diagnostics instead of throwing', async () => {
  process.env.KEENABLE_API_KEY = 'test-key'
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'trial quota reached' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch

  const response = await searchKeenable('occupational health RFP')
  assert.equal(response.configured, true)
  assert.equal(response.ok, false)
  assert.deepEqual(response.results, [])
  assert.match(response.error || '', /HTTP 429/i)
  assert.match(response.error || '', /trial quota reached/i)
})
