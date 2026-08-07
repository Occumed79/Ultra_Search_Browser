import test from 'node:test'
import assert from 'node:assert/strict'
import { searchSamGovOfficial } from '../src/lib/sam-gov-opportunities'

test('broad occupational-health search uses one Q533 SAM request', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.SAM_GOV_API_KEY
  process.env.SAM_GOV_API_KEY = 'test-sam-key'
  const requestedUrls: string[] = []

  globalThis.fetch = async (input: string | URL | Request) => {
    requestedUrls.push(String(input))
    return new Response(JSON.stringify({
      opportunitiesData: [{
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
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const response = await searchSamGovOfficial('Occupational Health Services RFP', 10)
    assert.equal(requestedUrls.length, 1)
    const url = new URL(requestedUrls[0])
    assert.equal(url.origin + url.pathname, 'https://api.sam.gov/opportunities/v2/search')
    assert.equal(url.searchParams.get('api_key'), 'test-sam-key')
    assert.equal(url.searchParams.get('ccode'), 'Q533')
    assert.equal(url.searchParams.has('title'), false)
    assert.ok(url.searchParams.get('postedFrom'))
    assert.ok(url.searchParams.get('postedTo'))
    assert.equal(response.diagnostics.queryCount, 1)
    assert.deepEqual(response.diagnostics.strategies, ['psc:Q533'])
    assert.equal(response.results.length, 1)
    assert.match(response.results[0].description, /Occupational health services/i)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.SAM_GOV_API_KEY
    else process.env.SAM_GOV_API_KEY = originalKey
  }
})

test('specific SAM search uses one focused buyer-language title request', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.SAM_GOV_API_KEY
  process.env.SAM_GOV_API_KEY = 'test-sam-key'
  const requestedUrls: string[] = []

  globalThis.fetch = async (input: string | URL | Request) => {
    requestedUrls.push(String(input))
    return new Response(JSON.stringify({ opportunitiesData: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const response = await searchSamGovOfficial('Pre-deployment health assessment RFP')
    assert.equal(requestedUrls.length, 1)
    const url = new URL(requestedUrls[0])
    assert.equal(url.searchParams.has('ccode'), false)
    assert.ok(url.searchParams.get('title'))
    assert.equal(response.diagnostics.queryCount, 1)
    assert.equal(response.diagnostics.strategies?.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.SAM_GOV_API_KEY
    else process.env.SAM_GOV_API_KEY = originalKey
  }
})

test('SAM.gov rejects inactive and award records before relevance gating', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.SAM_GOV_API_KEY
  process.env.SAM_GOV_API_KEY = 'test-sam-key'

  globalThis.fetch = async () => new Response(JSON.stringify({
    opportunitiesData: [
      { noticeId: 'inactive-1', title: 'Occupational Health Services', active: 'No', responseDeadLine: '12/31/2099', type: 'Solicitation' },
      { noticeId: 'award-1', title: 'Occupational Health Services Award', active: 'Yes', type: 'Award Notice' },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

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

test('SAM.gov 429 triggers cooldown and prevents immediate repeat calls', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.SAM_GOV_API_KEY
  process.env.SAM_GOV_API_KEY = 'test-sam-key'
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ message: 'rate limit' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  try {
    const first = await searchSamGovOfficial('Occupational Health Services RFP')
    const second = await searchSamGovOfficial('Occupational Health Services RFP')
    assert.equal(calls, 1)
    assert.equal(first.diagnostics.attempted, true)
    assert.match(first.diagnostics.error || '', /HTTP 429/i)
    assert.ok(first.diagnostics.cooldownUntil)
    assert.equal(second.diagnostics.attempted, false)
    assert.match(second.diagnostics.error || '', /cooling down/i)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.SAM_GOV_API_KEY
    else process.env.SAM_GOV_API_KEY = originalKey
  }
})
