import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetProviderKeyPoolForTests } from '../src/lib/provider-key-pool'
import { isKeenableConfigured, keenableKeyCount, searchKeenable } from '../src/lib/keenable'

const originalFetch = globalThis.fetch
const KEY_NAMES = [
  'KEENABLE_API_KEY',
  'KEENABLE_API_KEY_2',
  'KEENABLE_API_KEY_3',
  'KEENABLE_API_KEY_4',
]
const originalKeys = Object.fromEntries(KEY_NAMES.map(name => [name, process.env[name]]))
const originalBase = process.env.KEENABLE_API_BASE_URL
const originalMode = process.env.KEENABLE_SEARCH_MODE

function clearKeys() {
  for (const name of KEY_NAMES) delete process.env[name]
}

function restoreEnvironment() {
  globalThis.fetch = originalFetch
  clearKeys()
  for (const [name, value] of Object.entries(originalKeys)) {
    if (value !== undefined) process.env[name] = value
  }
  if (originalBase === undefined) delete process.env.KEENABLE_API_BASE_URL
  else process.env.KEENABLE_API_BASE_URL = originalBase
  if (originalMode === undefined) delete process.env.KEENABLE_SEARCH_MODE
  else process.env.KEENABLE_SEARCH_MODE = originalMode
  resetProviderKeyPoolForTests()
}

afterEach(restoreEnvironment)

test('Keenable is optional when no API key is configured', async () => {
  clearKeys()
  assert.equal(isKeenableConfigured(), false)

  const response = await searchKeenable('occupational health RFP')
  assert.equal(response.configured, false)
  assert.equal(response.ok, false)
  assert.deepEqual(response.results, [])
  assert.match(response.error || '', /KEENABLE_API_KEY/i)
})

test('Keenable sends the API key, pro mode, and normalizes web results', async () => {
  clearKeys()
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
  assert.equal(keenableKeyCount(), 1)
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

test('Keenable can fail through the whole four-key pool before succeeding', async () => {
  clearKeys()
  resetProviderKeyPoolForTests()
  process.env.KEENABLE_API_KEY = 'keenable-one'
  process.env.KEENABLE_API_KEY_2 = 'keenable-two'
  process.env.KEENABLE_API_KEY_3 = 'keenable-three'
  process.env.KEENABLE_API_KEY_4 = 'keenable-four'

  const keysSeen: string[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const key = new Headers(init?.headers).get('X-API-Key') || ''
    keysSeen.push(key)
    if (key !== 'keenable-four') {
      return new Response(JSON.stringify({ message: 'trial quota reached' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      results: [{
        title: 'Fourth Keenable key result',
        url: 'https://example.gov/procurement/rfp-4',
        snippet: 'Open occupational health RFP.',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const response = await searchKeenable('occupational health RFP')
  assert.equal(response.ok, true)
  assert.equal(response.keyCount, 4)
  assert.deepEqual(keysSeen, [
    'keenable-one',
    'keenable-two',
    'keenable-three',
    'keenable-four',
  ])
})

test('Keenable HTTP failures fail open with diagnostics instead of throwing', async () => {
  clearKeys()
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