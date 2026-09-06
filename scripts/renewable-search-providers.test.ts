import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resetProviderKeyPoolForTests } from '../src/lib/provider-key-pool'
import {
  isExaConfigured,
  isLangSearchConfigured,
  isTavilyConfigured,
  isTinyFishConfigured,
  searchExa,
  searchLangSearch,
  searchTavily,
  searchTinyFish,
} from '../src/lib/renewable-search-providers'

const originalFetch = globalThis.fetch
const ENV_NAMES = [
  'TAVILY_API_KEY', 'TAVILY_API_KEY_2', 'TAVILY_API_KEY_3', 'TAVILY_API_KEY_4',
  'EXA_SEARCH_API_KEY', 'EXA_SEARCH_API_KEY_2', 'EXA_SEARCH_API_KEY_3', 'EXA_SEARCH_API_KEY_4',
  'LANGSEARCH_API_KEY', 'TINYFISH_API_KEY',
]
const originalEnv = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]))

function clearProviderEnv() {
  for (const name of ENV_NAMES) delete process.env[name]
}

function restoreEnvironment() {
  globalThis.fetch = originalFetch
  clearProviderEnv()
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[name] = value
  }
  resetProviderKeyPoolForTests()
}

afterEach(restoreEnvironment)

test('Tavily rotates across configured numbered keys', async () => {
  clearProviderEnv()
  resetProviderKeyPoolForTests()
  process.env.TAVILY_API_KEY = 'tavily-one'
  process.env.TAVILY_API_KEY_2 = 'tavily-two'

  const authHeaders: string[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    authHeaders.push(new Headers(init?.headers).get('Authorization') || '')
    return new Response(JSON.stringify({
      results: [{
        title: 'Occupational Health RFP',
        url: 'https://example.gov/rfp/1',
        content: 'Open solicitation for employee medical evaluations.',
        score: 0.91,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  assert.equal(isTavilyConfigured(), true)
  const first = await searchTavily('occupational health RFP')
  const second = await searchTavily('medical surveillance solicitation')

  assert.deepEqual(authHeaders, ['Bearer tavily-one', 'Bearer tavily-two'])
  assert.equal(first.results[0].source, 'Tavily')
  assert.equal(second.ok, true)
})

test('Tavily can fail through the whole four-key pool before succeeding', async () => {
  clearProviderEnv()
  resetProviderKeyPoolForTests()
  process.env.TAVILY_API_KEY = 'tavily-one'
  process.env.TAVILY_API_KEY_2 = 'tavily-two'
  process.env.TAVILY_API_KEY_3 = 'tavily-three'
  process.env.TAVILY_API_KEY_4 = 'tavily-four'

  const authHeaders: string[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization') || ''
    authHeaders.push(auth)
    if (auth !== 'Bearer tavily-four') {
      return new Response(JSON.stringify({ detail: 'quota reached' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      results: [{ title: 'Fourth key result', url: 'https://example.gov/rfp/4', content: 'Open RFP.' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const response = await searchTavily('occupational health RFP')
  assert.equal(response.ok, true)
  assert.deepEqual(authHeaders, [
    'Bearer tavily-one',
    'Bearer tavily-two',
    'Bearer tavily-three',
    'Bearer tavily-four',
  ])
})

test('Exa can fail through the whole four-key pool before succeeding', async () => {
  clearProviderEnv()
  resetProviderKeyPoolForTests()
  process.env.EXA_SEARCH_API_KEY = 'exa-one'
  process.env.EXA_SEARCH_API_KEY_2 = 'exa-two'
  process.env.EXA_SEARCH_API_KEY_3 = 'exa-three'
  process.env.EXA_SEARCH_API_KEY_4 = 'exa-four'

  const keysSeen: string[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const key = new Headers(init?.headers).get('x-api-key') || ''
    keysSeen.push(key)
    if (key !== 'exa-four') {
      return new Response(JSON.stringify({ message: 'quota reached' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      results: [{
        title: 'Fourth Exa key result',
        url: 'https://exa.example.gov/rfp/4',
        highlights: ['Open occupational health RFP.'],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const response = await searchExa('occupational health RFP')
  assert.equal(response.ok, true)
  assert.equal(response.keyCount, 4)
  assert.deepEqual(keysSeen, ['exa-one', 'exa-two', 'exa-three', 'exa-four'])
})

test('Exa, LangSearch, and TinyFish use their live web search APIs and normalize results', async () => {
  clearProviderEnv()
  resetProviderKeyPoolForTests()
  process.env.EXA_SEARCH_API_KEY = 'exa-one'
  process.env.LANGSEARCH_API_KEY = 'lang-one'
  process.env.TINYFISH_API_KEY = 'tiny-one'

  const calls: Array<{ url: string; headers: Headers; body: string }> = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body || '') })

    if (url.includes('api.exa.ai/search')) {
      return new Response(JSON.stringify({
        results: [{
          title: 'Exa Procurement Result',
          url: 'https://exa.example.gov/rfp',
          highlights: ['Open occupational health solicitation with employee medical examinations.'],
          score: 0.8,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('api.langsearch.com/v1/web-search')) {
      return new Response(JSON.stringify({
        code: 200,
        data: { webPages: { value: [{ name: 'LangSearch Result', url: 'https://lang.example.gov/bid', snippet: 'Open bid.' }] } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('api.search.tinyfish.ai')) {
      return new Response(JSON.stringify({
        results: [{ position: 1, title: 'TinyFish Result', url: 'https://tiny.example.gov/solicitation', snippet: 'Current solicitation.' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`Unexpected URL ${url}`)
  }) as typeof fetch

  assert.equal(isExaConfigured(), true)
  assert.equal(isLangSearchConfigured(), true)
  assert.equal(isTinyFishConfigured(), true)

  const [exa, lang, tiny] = await Promise.all([
    searchExa('employee medical exams', { maxResults: 20 }),
    searchLangSearch('medical readiness procurement'),
    searchTinyFish('occupational health solicitation', { purpose: 'Find current procurement opportunities.' }),
  ])

  assert.equal(exa.results[0].source, 'Exa')
  assert.match(exa.results[0].description, /occupational health solicitation/i)
  assert.equal(lang.results[0].source, 'LangSearch')
  assert.equal(tiny.results[0].source, 'TinyFish')

  const exaCall = calls.find(call => call.url.includes('api.exa.ai/search'))
  const langCall = calls.find(call => call.url.includes('api.langsearch.com/v1/web-search'))
  const tinyCall = calls.find(call => call.url.includes('api.search.tinyfish.ai'))
  assert.equal(exaCall?.headers.get('x-api-key'), 'exa-one')
  assert.equal(langCall?.headers.get('Authorization'), 'Bearer lang-one')
  assert.equal(tinyCall?.headers.get('X-API-Key'), 'tiny-one')

  const exaBody = JSON.parse(exaCall?.body || '{}')
  assert.equal(exaBody.numResults, 10)
  assert.deepEqual(exaBody.contents, { highlights: { dynamic: true } })

  const tinyUrl = new URL(tinyCall?.url || 'https://api.search.tinyfish.ai')
  assert.equal(tinyUrl.searchParams.get('query'), 'occupational health solicitation')
  assert.equal(tinyUrl.searchParams.get('location'), 'US')
  assert.equal(tinyUrl.searchParams.get('language'), 'en')
  assert.equal(tinyUrl.searchParams.has('purpose'), false)
})

test('Ultra Search live retrieval fan-out includes every renewable discovery source and excludes Algolia memory', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const route = readFileSync(`${root}/src/app/api/search/route.ts`, 'utf8')
  const env = readFileSync(`${root}/.env.example`, 'utf8')

  for (const source of ['Keenable', 'TinyFish', 'Tavily', 'Exa', 'LangSearch']) {
    assert.match(route, new RegExp(source, 'i'))
  }
  assert.doesNotMatch(route, /Algolia memory/i)

  for (const variable of [
    'SEARXNG_URL', 'SEARXNG_ENGINES',
    'KEENABLE_API_KEY_2', 'KEENABLE_API_KEY_3', 'KEENABLE_API_KEY_4',
    'TINYFISH_API_KEY',
    'TAVILY_API_KEY_2', 'TAVILY_API_KEY_3', 'TAVILY_API_KEY_4',
    'EXA_SEARCH_API_KEY_2', 'EXA_SEARCH_API_KEY_3', 'EXA_SEARCH_API_KEY_4',
    'LANGSEARCH_API_KEY',
  ]) {
    assert.match(env, new RegExp(`^${variable}=`, 'm'))
  }
})