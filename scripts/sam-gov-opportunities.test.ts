import test from 'node:test'
import assert from 'node:assert/strict'
import { searchSamGovOfficial } from '../src/lib/sam-gov-opportunities'

test('SAM.gov search uses title, PSC, and Occu-Med capability portfolio strategies', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.SAM_GOV_API_KEY
  process.env.SAM_GOV_API_KEY = 'test-sam-key'
  const requestedUrls: string[] = []

  globalThis.fetch = async (input: string | URL | Request) => {
    requestedUrls.push(String(input))
    const url = new URL(String(input))
    const isPsc = url.searchParams.get('ccode') === 'Q533'
    const isOconus = url.searchParams.get('title')?.toLowerCase() === 'oconus medical'

    return new Response(JSON.stringify({
      totalRecords: isPsc || isOconus ? 1 : 0,
      opportunitiesData: isPsc ? [{
        noticeId: 'q533-123',
        title: 'Federal Employee Health Support',
        solicitationNumber: 'OH-2026-001',
        fullParentPathName: 'Example Federal Agency',
        postedDate: '08/01/2026',
        responseDeadLine: '12/31/2099',
        type: 'Solicitation',
        active: 'Yes',
        classificationCode: 'Q533',
        naicsCode: '621498',
      }] : isOconus ? [{
        noticeId: 'oconus-456',
        title: 'OCONUS Medical Q-Coded Services',
        solicitationNumber: 'MED-2026-002',
        fullParentPathName: 'Defense Health Agency',
        postedDate: '07/20/2026',
        responseDeadLine: '12/31/2099',
        type: 'Combined Synopsis/Solicitation',
        active: 'Yes',
      }] : [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const response = await searchSamGovOfficial('Occupational Health Services RFP', 10)
    const urls = requestedUrls.map(value => new URL(value))

    assert.ok(urls.length >= 5)
    for (const url of urls) {
      assert.equal(url.origin + url.pathname, 'https://api.sam.gov/opportunities/v2/search')
      assert.equal(url.searchParams.get('api_key'), 'test-sam-key')
      assert.ok(url.searchParams.get('postedFrom'))
      assert.ok(url.searchParams.get('postedTo'))
      assert.equal(url.searchParams.has('q'), false)
      assert.ok(url.searchParams.get('title') || url.searchParams.get('ccode'))
    }

    assert.ok(urls.some(url => url.searchParams.get('title') === 'Occupational Health Services'))
    assert.ok(urls.some(url => url.searchParams.get('ccode') === 'Q533'))
    assert.ok(urls.some(url => url.searchParams.get('title') === 'OCONUS medical'))
    assert.ok(urls.some(url => url.searchParams.get('title') === 'medical surveillance'))
    assert.equal(response.diagnostics.configured, true)
    assert.equal(response.diagnostics.successful, true)
    assert.ok(response.diagnostics.strategies?.includes('psc:Q533'))
    assert.equal(response.results.length, 2)
    assert.ok(response.results.some(result => result.url === 'https://sam.gov/opp/q533-123/view'))
    assert.ok(response.results.some(result => result.url === 'https://sam.gov/opp/oconus-456/view'))
    const q533 = response.results.find(result => result.url.includes('q533-123'))
    assert.match(q533?.description || '', /Occupational and public health services/i)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.SAM_GOV_API_KEY
    else process.env.SAM_GOV_API_KEY = originalKey
  }
})

test('SAM.gov search rejects inactive and award records before relevance gating', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.SAM_GOV_API_KEY
  process.env.SAM_GOV_API_KEY = 'test-sam-key'

  globalThis.fetch = async () => new Response(JSON.stringify({
    opportunitiesData: [
      {
        noticeId: 'inactive-1',
        title: 'Occupational Health Services',
        active: 'No',
        responseDeadLine: '12/31/2099',
        type: 'Solicitation',
      },
      {
        noticeId: 'award-1',
        title: 'Occupational Health Services Award',
        active: 'Yes',
        type: 'Award Notice',
      },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    const response = await searchSamGovOfficial('Occupational Health Services RFP')
    assert.deepEqual(response.results, [])
    assert.equal(response.diagnostics.successful, false)
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
