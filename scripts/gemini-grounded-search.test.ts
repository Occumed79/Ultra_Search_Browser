import test from 'node:test'
import assert from 'node:assert/strict'
import {
  geminiGroundedSearchCapabilities,
  searchGeminiGroundedWeb,
} from '../src/lib/gemini-grounded-search'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('Gemini grounded search remains disabled without its existing Gemini key', async () => {
  const capability = geminiGroundedSearchCapabilities({})
  assert.equal(capability.configured, false)

  const search = await searchGeminiGroundedWeb(
    'occupational health services',
    'provider',
    {},
    async () => {
      throw new Error('fetch should not run')
    }
  )

  assert.equal(search.results.length, 0)
  assert.equal(search.diagnostics.attempted, false)
})

test('Gemini grounded search converts Google grounding chunks into real search results', async () => {
  let requestBody: Record<string, unknown> = {}
  let apiKey = ''
  const search = await searchGeminiGroundedWeb(
    'occupational health services RFP',
    'procurement',
    {
      GEMINI_API_KEY: 'gemini-test-key',
      GEMINI_SEARCH_MODEL: 'gemini-3.5-flash-lite',
    },
    async (_input, init) => {
      apiKey = new Headers(init?.headers).get('x-goog-api-key') || ''
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return jsonResponse({
        candidates: [{
          content: {
            parts: [{
              text: 'County A has an occupational health services RFP. Clinic B provides occupational medicine.',
            }],
          },
          groundingMetadata: {
            webSearchQueries: [
              'occupational health services RFP',
              'occupational medicine procurement',
            ],
            groundingChunks: [
              {
                web: {
                  title: 'County A Occupational Health RFP',
                  uri: 'https://county.example.gov/procurement/occupational-health-rfp',
                },
              },
              {
                web: {
                  title: 'Clinic B Occupational Medicine',
                  uri: 'https://clinic.example.com/occupational-medicine',
                },
              },
            ],
            groundingSupports: [
              {
                segment: { text: 'County A has an occupational health services RFP.' },
                groundingChunkIndices: [0],
              },
              {
                segment: { text: 'Clinic B provides occupational medicine.' },
                groundingChunkIndices: [1],
              },
            ],
          },
        }],
      })
    }
  )

  assert.equal(apiKey, 'gemini-test-key')
  assert.deepEqual(requestBody.tools, [{ google_search: {} }])
  assert.equal(search.results.length, 2)
  assert.equal(search.results[0].source, 'Gemini Google Search')
  assert.equal(search.results[0].domain, 'county.example.gov')
  assert.match(search.results[0].description, /occupational health services RFP/i)
  assert.equal(search.diagnostics.successful, true)
  assert.deepEqual(search.diagnostics.searchQueries, [
    'occupational health services RFP',
    'occupational medicine procurement',
  ])
})

test('Gemini grounded search reports upstream failures without throwing or exposing the key', async () => {
  const search = await searchGeminiGroundedWeb(
    'occupational health services',
    'provider',
    { GEMINI_API_KEY: 'do-not-expose-this-key' },
    async () => jsonResponse({
      error: { message: 'Search grounding quota unavailable' },
    }, 429)
  )

  assert.equal(search.results.length, 0)
  assert.equal(search.diagnostics.attempted, true)
  assert.equal(search.diagnostics.successful, false)
  assert.match(search.diagnostics.error || '', /HTTP 429/i)
  assert.doesNotMatch(JSON.stringify(search), /do-not-expose-this-key/)
})
