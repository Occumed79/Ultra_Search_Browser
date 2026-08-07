import test from 'node:test'
import assert from 'node:assert/strict'
import { searchTavilyWeb, tavilySearchConfigured } from '../src/lib/tavily-search'

test('Tavily rescue is disabled without the configured trial key', async () => {
  assert.equal(tavilySearchConfigured({} as NodeJS.ProcessEnv), false)
  const response = await searchTavilyWeb(
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

test('Tavily uses the current bearer-auth search contract and normalizes web results', async () => {
  let requestedUrl = ''
  let authorization = ''
  let requestBody: Record<string, unknown> = {}

  const response = await searchTavilyWeb(
    'Occupational Health Services RFP',
    10,
    { TAVILY_API_KEY: 'tvly-test-key' } as NodeJS.ProcessEnv,
    async (input, init) => {
      requestedUrl = String(input)
      authorization = new Headers(init?.headers).get('Authorization') || ''
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({
        query: 'Occupational Health Services RFP',
        results: [{
          title: 'County Occupational Health Services RFP',
          url: 'https://county.example.gov/bids/occupational-health#details',
          content: 'Request for proposals for occupational health services and employee medical evaluations.',
          score: 0.91,
        }],
        response_time: '0.8',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  )

  assert.equal(requestedUrl, 'https://api.tavily.com/search')
  assert.equal(authorization, 'Bearer tvly-test-key')
  assert.equal(requestBody.query, 'Occupational Health Services RFP')
  assert.equal(requestBody.search_depth, 'basic')
  assert.equal(requestBody.include_answer, false)
  assert.equal(requestBody.include_raw_content, false)
  assert.equal(requestBody.max_results, 10)
  assert.equal(response.diagnostics.successful, true)
  assert.equal(response.results.length, 1)
  assert.equal(response.results[0].source, 'Tavily Search')
  assert.equal(response.results[0].url, 'https://county.example.gov/bids/occupational-health')
  assert.match(response.results[0].description, /request for proposals/i)
})

test('Tavily reports quota and rate-limit failures without exposing the key', async () => {
  const response = await searchTavilyWeb(
    'Occupational Health Services RFP',
    10,
    { TAVILY_API_KEY: 'tvly-secret-value' } as NodeJS.ProcessEnv,
    async () => new Response(JSON.stringify({ detail: 'Usage limit reached' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })
  )

  assert.equal(response.results.length, 0)
  assert.equal(response.diagnostics.attempted, true)
  assert.equal(response.diagnostics.successful, false)
  assert.match(response.diagnostics.error || '', /HTTP 429/i)
  assert.doesNotMatch(JSON.stringify(response), /tvly-secret-value/)
})
