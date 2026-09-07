import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { searchSearXNG } from '../src/lib/searxng'

const originalFetch = globalThis.fetch
const originalUrl = process.env.SEARXNG_URL
const originalEngines = process.env.SEARXNG_ENGINES
const originalGap = process.env.SEARXNG_MIN_REQUEST_GAP_MS
const originalRetry = process.env.SEARXNG_RETRY_DELAY_MS

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  globalThis.fetch = originalFetch
  restore('SEARXNG_URL', originalUrl)
  restore('SEARXNG_ENGINES', originalEngines)
  restore('SEARXNG_MIN_REQUEST_GAP_MS', originalGap)
  restore('SEARXNG_RETRY_DELAY_MS', originalRetry)
})

test('SearXNG retries one transient 429 instead of immediately poisoning source health', async () => {
  process.env.SEARXNG_URL = 'https://search.example.test'
  process.env.SEARXNG_ENGINES = 'bing,duckduckgo'
  process.env.SEARXNG_MIN_REQUEST_GAP_MS = '0'
  process.env.SEARXNG_RETRY_DELAY_MS = '0'

  let attempts = 0
  globalThis.fetch = (async () => {
    attempts += 1
    if (attempts === 1) {
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '0' },
      })
    }
    return new Response(JSON.stringify({
      results: [{
        title: 'Employee Medical Examination RFP',
        url: 'https://county.example.gov/procurement/medical-exams',
        content: 'Request for proposals for employee medical examinations.',
        engine: 'bing',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const response = await searchSearXNG('employee medical examinations RFP')
  assert.equal(attempts, 2)
  assert.equal(response.ok, true)
  assert.equal(response.results.length, 1)
  assert.deepEqual(response.engines, ['bing'])
})

test('SearXNG stops after one bounded retry when rate limiting persists', async () => {
  process.env.SEARXNG_URL = 'https://search.example.test'
  process.env.SEARXNG_MIN_REQUEST_GAP_MS = '0'
  process.env.SEARXNG_RETRY_DELAY_MS = '0'

  let attempts = 0
  globalThis.fetch = (async () => {
    attempts += 1
    return new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': '0' },
    })
  }) as typeof fetch

  const response = await searchSearXNG('occupational health procurement')
  assert.equal(attempts, 2)
  assert.equal(response.ok, false)
  assert.match(response.error || '', /HTTP 429 after bounded retry/i)
})