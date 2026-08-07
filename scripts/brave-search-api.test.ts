import test from 'node:test'
import assert from 'node:assert/strict'
import { braveApiSearchConfigured, searchBraveApi } from '../src/lib/brave-search-api'

test('Brave API rescue is skipped when no configured key is present', async () => {
  assert.equal(braveApiSearchConfigured({} as NodeJS.ProcessEnv), false)
  const response = await searchBraveApi(
    'Occupational Health Services RFP',
    10,
    {} as NodeJS.ProcessEnv,
    async () => {
      throw new Error('fetch should not run')
    }
  )
  assert.equal(response.diagnostics.attempted, false)
  assert.deepEqual(response.results, [])
})

test('Brave API supports both BRAVE_API_KEY and BRAVE_SEARCH_API_KEY aliases', () => {
  assert.equal(braveApiSearchConfigured({ BRAVE_API_KEY: 'a' } as NodeJS.ProcessEnv), true)
  assert.equal(braveApiSearchConfigured({ BRAVE_SEARCH_API_KEY: 'b' } as NodeJS.ProcessEnv), true)
})

test('Brave API uses current search endpoint, subscription header, and normalizes results', async () => {
  let requestedUrl = ''
  let subscriptionToken = ''
  const response = await searchBraveApi(
    '"Occupational Health Services" RFP solicitation 2026',
    10,
    { BRAVE_API_KEY: 'brave-test-key' } as NodeJS.ProcessEnv,
    async (input, init) => {
      requestedUrl = String(input)
      subscriptionToken = new Headers(init?.headers).get('X-Subscription-Token') || ''
      return new Response(JSON.stringify({
        type: 'search',
        web: {
          results: [{
            title: 'Occupational Health Services Request for Proposals',
            url: 'https://county.example.gov/procurement/oh-rfp#notice',
            description: 'Request for proposals for employee occupational health services.',
            extra_snippets: ['Responses due September 30, 2026.'],
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  )

  const url = new URL(requestedUrl)
  assert.equal(url.origin + url.pathname, 'https://api.search.brave.com/res/v1/web/search')
  assert.equal(url.searchParams.get('q'), '"Occupational Health Services" RFP solicitation 2026')
  assert.equal(url.searchParams.get('count'), '10')
  assert.equal(url.searchParams.get('country'), 'US')
  assert.equal(url.searchParams.get('search_lang'), 'en')
  assert.equal(url.searchParams.get('extra_snippets'), 'true')
  assert.equal(subscriptionToken, 'brave-test-key')
  assert.equal(response.diagnostics.successful, true)
  assert.equal(response.results.length, 1)
  assert.equal(response.results[0].source, 'Brave Search API')
  assert.equal(response.results[0].url, 'https://county.example.gov/procurement/oh-rfp')
  assert.match(response.results[0].description, /Responses due September 30, 2026/i)
})

test('Brave API reports upstream quota failure without exposing the key', async () => {
  const response = await searchBraveApi(
    'Occupational Health Services RFP',
    10,
    { BRAVE_API_KEY: 'super-secret-brave-key' } as NodeJS.ProcessEnv,
    async () => new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })
  )

  assert.equal(response.diagnostics.attempted, true)
  assert.equal(response.diagnostics.successful, false)
  assert.match(response.diagnostics.error || '', /HTTP 429/i)
  assert.doesNotMatch(JSON.stringify(response), /super-secret-brave-key/)
})
