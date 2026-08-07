import test from 'node:test'
import assert from 'node:assert/strict'
import { searchSamGovOfficial } from '../src/lib/sam-gov-opportunities'

test('SAM.gov search uses the current Opportunities v2 contract and opportunitiesData payload', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.SAM_GOV_API_KEY
  process.env.SAM_GOV_API_KEY = 'test-sam-key'
  let requestedUrl = ''

  globalThis.fetch = async (input: string | URL | Request) => {
    requestedUrl = String(input)
    return new Response(JSON.stringify({
      totalRecords: 1,
      opportunitiesData: [{
        noticeId: 'abc123',
        title: 'Occupational Health Services',
        solicitationNumber: 'OH-2026-001',
        fullParentPathName: 'Example Federal Agency',
        postedDate: '08/01/2026',
        responseDeadLine: '12/31/2099',
        type: 'Solicitation',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const response = await searchSamGovOfficial('Occupational Health Services RFP', 10)
    const url = new URL(requestedUrl)

    assert.equal(url.origin + url.pathname, 'https://api.sam.gov/opportunities/v2/search')
    assert.equal(url.searchParams.get('api_key'), 'test-sam-key')
    assert.ok(url.searchParams.get('postedFrom'))
    assert.ok(url.searchParams.get('postedTo'))
    assert.equal(url.searchParams.get('title'), 'Occupational Health Services')
    assert.equal(url.searchParams.has('q'), false)
    assert.equal(response.diagnostics.configured, true)
    assert.equal(response.diagnostics.successful, true)
    assert.equal(response.results.length, 1)
    assert.equal(response.results[0].source, 'SAM.gov Official API')
    assert.equal(response.results[0].url, 'https://sam.gov/opp/abc123/view')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.SAM_GOV_API_KEY
    else process.env.SAM_GOV_API_KEY = originalKey
  }
})

test('SAM.gov search is skipped cleanly when no server key is configured', async () => {
  const originalKey = process.env.SAM_GOV_API_KEY
  delete process.env.SAM_GOV_API_KEY
  try {
    const response = await searchSamGovOfficial('Occupational Health Services RFP')
    assert.equal(response.diagnostics.configured, false)
    assert.equal(response.diagnostics.attempted, false)
    assert.deepEqual(response.results, [])
  } finally {
    if (originalKey !== undefined) process.env.SAM_GOV_API_KEY = originalKey
  }
})
