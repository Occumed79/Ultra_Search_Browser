import test from 'node:test'
import assert from 'node:assert/strict'
import { deduplicateEntities } from '../src/lib/entity-dedupe'
import { inspectPageSignals, validateCandidatePage } from '../src/lib/page-validation'
import { classifyResultStatus, parseStatusDate } from '../src/lib/result-status'
import type { ScrapedResult } from '../src/types/search'

const now = new Date('2026-07-24T12:00:00Z')

function result(overrides: Partial<ScrapedResult>): ScrapedResult {
  return {
    title: 'Occupational Health Services RFP 26-104',
    url: 'https://vendor.example.org/rfp/26-104',
    description: 'Request for proposals for occupational health services.',
    domain: 'vendor.example.org',
    source: 'Bing',
    rank: 1,
    score: 80,
    validation: {
      status: 'valid',
      relevance: 0.9,
      reason: 'Relevant',
      matchedConcepts: ['occupational', 'health'],
      mode: 'local-rules',
    },
    ...overrides,
  }
}

test('status dates reject invalid calendar dates', () => {
  assert.equal(parseStatusDate('2026-02-31'), undefined)
  assert.equal(parseStatusDate('February 31, 2026'), undefined)
  assert.equal(parseStatusDate('2026-08-14')?.toISOString().slice(0, 10), '2026-08-14')
})

test('latest amended procurement deadline controls open versus expired', () => {
  const open = classifyResultStatus(
    'Posted June 1, 2026. Original due date July 1, 2026. Amendment: responses due August 14, 2026.',
    'procurement',
    now
  )
  assert.equal(open.status, 'open')
  assert.match(open.reason, /2026-08-14/)

  const expired = classifyResultStatus(
    'Proposals due June 20, 2026. Closing date July 1, 2026.',
    'procurement',
    now
  )
  assert.equal(expired.status, 'expired')
})

test('explicit procurement lifecycle signals win over dates', () => {
  assert.equal(classifyResultStatus('This solicitation has been cancelled.', 'procurement', now).status, 'cancelled')
  assert.equal(classifyResultStatus('Notice of award. The contract was awarded to Example LLC.', 'procurement', now).status, 'awarded')
  assert.equal(classifyResultStatus('Responses are closed and no longer accepting proposals.', 'procurement', now).status, 'closed')
})

test('timeless provider pages remain current rather than expired', () => {
  const assessment = classifyResultStatus(
    'Our occupational medicine clinic provides audiometry, respirator fit testing, and employer physicals.',
    'provider',
    now
  )
  assert.equal(assessment.status, 'current')
})

test('page signal inspection identifies blocked, login, generic, dead, and thin pages', () => {
  assert.equal(inspectPageSignals('Access denied. Verify you are human. Cloudflare Ray ID 123', 'https://a.test/page').availability, 'blocked')
  assert.equal(inspectPageSignals('Please sign in to continue. Account login.', 'https://a.test/private').availability, 'login')
  assert.equal(inspectPageSignals('Welcome to our organization homepage with general information about our departments and services.', 'https://a.test/', 'https://a.test/opportunity/123').availability, 'generic')
  assert.equal(inspectPageSignals('404 Not Found. The requested page could not be found.', 'https://a.test/missing').availability, 'dead')
  assert.equal(inspectPageSignals('Very little text', 'https://a.test/page').availability, 'thin')
})

test('entity dedupe groups matching solicitation IDs and selects official source', () => {
  const unofficial = result({
    url: 'https://aggregator.example.com/opportunity/26-104',
    domain: 'aggregator.example.com',
    score: 120,
  })
  const official = result({
    url: 'https://county.gov/procurement/rfp-26-104',
    domain: 'county.gov',
    source: 'Google',
    score: 70,
    pageValidation: {
      checkedAt: now.toISOString(),
      requestedUrl: 'https://county.gov/procurement/rfp-26-104',
      finalUrl: 'https://county.gov/procurement/rfp-26-104',
      httpStatus: 200,
      availability: 'reachable',
      reason: 'Reachable',
      evidence: ['Responses due August 14, 2026.'],
      extractedTextLength: 1200,
      cached: false,
      lifecycle: {
        status: 'open',
        reason: 'Future deadline',
        confidence: 0.95,
        dates: [],
      },
    },
  })
  const outcome = deduplicateEntities([unofficial, official], 'procurement')
  assert.equal(outcome.results.length, 1)
  assert.equal(outcome.duplicates.length, 1)
  assert.equal(outcome.results[0].domain, 'county.gov')
  assert.equal(outcome.results[0].entity?.confirmationCount, 2)
  assert.equal(outcome.duplicates[0].bucket, 'duplicate')
})

test('page validator rejects private network targets before fetching', async () => {
  let called = false
  const assessment = await validateCandidatePage(
    result({ url: 'http://127.0.0.1/private', domain: '127.0.0.1' }),
    'web',
    'test query',
    {
      fetchImpl: (async () => {
        called = true
        throw new Error('must not fetch')
      }) as typeof fetch,
    }
  )
  assert.equal(called, false)
  assert.equal(assessment.availability, 'error')
  assert.match(assessment.reason, /private\/local/)
})
