import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectPageSignals, validateCandidatePage } from '../src/lib/page-validation'
import type { ScrapedResult } from '../src/types/search'

function portalCandidate(url: string): ScrapedResult {
  return {
    title: 'Occupational Health Services Opportunity',
    url,
    description: 'Occupational health services RFP opportunity.',
    domain: new URL(url).hostname,
    source: 'SearXNG',
    rank: 1,
    score: 80,
    retrieval: {
      sources: ['SearXNG'],
      queries: ['occupational health services RFP'],
      purposes: ['portal'],
      overlap: 1,
    },
  }
}

test('scanned-looking direct procurement documents go to review instead of hard rejection', () => {
  const assessment = inspectPageSignals(
    'RFP',
    'https://county.gov/procurement/RFP-26-104.pdf',
    'https://county.gov/procurement/RFP-26-104.pdf',
    'Occupational Health Services RFP 26-104'
  )

  assert.equal(assessment.availability, 'unsupported')
  assert.match(assessment.reason, /scanned|image-only|manual review/i)
})

test('thin procurement portal shells go to review after linked-package discovery has had a chance to run', async () => {
  const assessment = await validateCandidatePage(
    portalCandidate('https://county.gov/procurement/opportunities/26-104'),
    'procurement',
    'occupational health services',
    {
      bypassCache: true,
      inspectPackage: true,
      fetchImpl: (async () => new Response(
        '<html><head><title>Opportunity 26-104</title></head><body>Loading opportunity...</body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )) as typeof fetch,
    }
  )

  assert.equal(assessment.availability, 'unsupported')
  assert.match(assessment.reason, /client-rendered|manual review/i)
})

test('known procurement portal hosts are reviewable when server-rendered content is thin', async () => {
  const assessment = await validateCandidatePage(
    portalCandidate('https://agency.bonfirehub.com/opportunities/12345'),
    'procurement',
    'occupational health services',
    {
      bypassCache: true,
      inspectPackage: true,
      fetchImpl: (async () => new Response(
        '<html><head><title>RFP 12345</title></head><body>Loading...</body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )) as typeof fetch,
    }
  )

  assert.equal(assessment.availability, 'unsupported')
})

test('ordinary thin provider pages remain hard-rejected as thin', () => {
  const assessment = inspectPageSignals(
    'Occupational medicine services',
    'https://clinic.example.com/services/occupational-health',
    'https://clinic.example.com/services/occupational-health',
    'Occupational Health Clinic'
  )

  assert.equal(assessment.availability, 'thin')
})
