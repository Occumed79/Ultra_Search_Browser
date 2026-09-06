import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCandidatePage } from '../src/lib/page-validation'
import type { ScrapedResult } from '../src/types/search'

function candidate(): ScrapedResult {
  return {
    title: 'Occupational Health Services Opportunity',
    url: 'https://county.gov/procurement/opportunities/26-104',
    description: 'Occupational health services opportunity.',
    domain: 'county.gov',
    source: 'SearXNG · google cse',
    rank: 1,
    score: 90,
    retrieval: {
      sources: ['SearXNG · google cse'],
      queries: ['occupational health services RFP solicitation'],
      purposes: ['portal'],
      overlap: 1,
    },
  }
}

test('thin procurement landing pages inspect linked solicitation evidence before rejection', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/procurement/opportunities/26-104')) {
      return new Response(
        '<html><head><title>Opportunity 26-104</title></head><body><a href="/procurement/documents/26-104">RFP solicitation documents</a></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    if (url.endsWith('/procurement/documents/26-104')) {
      return new Response(
        '<html><head><title>RFP 26-104 Occupational Health Services</title></head><body><h1>Request for Proposals 26-104</h1><p>The County requests proposals for occupational health services including pre-employment examinations, medical surveillance, audiometry, spirometry, respirator medical clearance, drug testing, and vaccinations for employees.</p><p>Proposals are due September 30, 2099. The contract opportunity remains open and active until the submission deadline.</p></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  const assessment = await validateCandidatePage(
    candidate(),
    'procurement',
    'occupational health services',
    { fetchImpl, bypassCache: true, inspectPackage: true }
  )

  assert.equal(assessment.availability, 'reachable')
  assert.ok((assessment.packageAnalysis?.inspectedCount || 0) >= 1)
  assert.match(assessment.extractedText, /Request for Proposals 26-104/i)
  assert.match(assessment.extractedText, /medical surveillance/i)
  assert.equal(assessment.lifecycle.status, 'open')
})

test('thin procurement shells without visible solicitation links are withheld for review', async () => {
  const fetchImpl = (async () => new Response(
    '<html><head><title>Occupational Health Opportunity</title></head><body>Loading opportunity.</body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )) as typeof fetch

  const assessment = await validateCandidatePage(
    candidate(),
    'procurement',
    'occupational health services',
    { fetchImpl, bypassCache: true, inspectPackage: true }
  )

  assert.equal(assessment.availability, 'unsupported')
  assert.equal(assessment.packageAnalysis, undefined)
  assert.match(assessment.reason, /client-rendered|manual review/i)
})