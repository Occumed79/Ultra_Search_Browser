import test from 'node:test'
import assert from 'node:assert/strict'
import { indexResultsInPersistentMemory, isVerifiedMemoryCandidate } from '../src/lib/memory-indexing'
import {
  isUsableExternalResult,
  parseBingRss,
  parseDuckDuckGoLite,
} from '../src/lib/search-response-parsers'
import { isVerifiedResult, verifiedResultsOnly } from '../src/lib/verified-results'
import type { ScrapedResult } from '../src/types/search'

function validResult(overrides: Partial<ScrapedResult> = {}): ScrapedResult {
  return {
    title: 'OSHA Occupational Health Services',
    url: 'https://www.osha.gov/occupational-health',
    description: 'Official occupational health guidance and services.',
    domain: 'osha.gov',
    source: 'Bing',
    rank: 1,
    score: 92,
    bucket: 'valid',
    validation: {
      status: 'valid',
      relevance: 0.96,
      reason: 'The official page directly supports the complete query.',
      matchedConcepts: ['occupational health', 'services'],
      mode: 'cerebras',
    },
    pageValidation: {
      checkedAt: '2026-07-24T12:00:00.000Z',
      requestedUrl: 'https://www.osha.gov/occupational-health',
      finalUrl: 'https://www.osha.gov/occupational-health',
      httpStatus: 200,
      contentType: 'text/html',
      availability: 'reachable',
      reason: 'Reachable public page.',
      evidence: ['OSHA occupational health services and guidance.'],
      extractedTextLength: 2400,
      contentHash: 'abc123',
      cached: false,
      lifecycle: {
        status: 'current',
        reason: 'Current timeless guidance page.',
        confidence: 0.9,
        dates: [],
      },
    },
    ...overrides,
  }
}

test('only reachable valid results enter the main verified list', () => {
  const valid = validResult()
  const uncertain = validResult({
    url: 'https://example.com/unverified',
    bucket: 'uncertain',
    validation: { ...valid.validation!, status: 'uncertain' },
  })
  const blocked = validResult({
    url: 'https://example.com/blocked',
    pageValidation: { ...valid.pageValidation!, availability: 'error' },
  })
  const expired = validResult({
    url: 'https://example.com/expired',
    pageValidation: {
      ...valid.pageValidation!,
      lifecycle: { ...valid.pageValidation!.lifecycle, status: 'expired' },
    },
  })

  assert.equal(isVerifiedResult(valid), true)
  assert.equal(isVerifiedResult(uncertain), false)
  assert.equal(isVerifiedResult(blocked), false)
  assert.equal(isVerifiedResult(expired), false)
  assert.deepEqual(verifiedResultsOnly([uncertain, valid, blocked, expired]), [valid])
})

test('persistent vector memory rejects uncertain and inaccessible results before database access', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    const valid = validResult()
    const uncertain = validResult({
      url: 'https://example.com/uncertain',
      bucket: 'uncertain',
      validation: { ...valid.validation!, status: 'uncertain' },
    })
    assert.equal(isVerifiedMemoryCandidate(valid), true)
    assert.equal(isVerifiedMemoryCandidate(uncertain), false)

    const diagnostics = await indexResultsInPersistentMemory([uncertain, valid], 'government')
    assert.equal(diagnostics.enabled, false)
    assert.equal(diagnostics.attempted, 1)
    assert.equal(diagnostics.indexed, 0)
    assert.equal(diagnostics.rejectedUnverified, 1)
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  }
})

test('structural result guard rejects search-engine and authentication navigation', () => {
  assert.equal(isUsableExternalResult('https://www.bing.com/search?q=test', 'Search results'), false)
  assert.equal(isUsableExternalResult('https://login.live.com/', 'Sign in to your account'), false)
  assert.equal(isUsableExternalResult('https://account.microsoft.com/account', 'Create your Microsoft account'), false)
  assert.equal(isUsableExternalResult('https://www.osha.gov/occupational-health', 'Occupational Health'), true)
})

test('Bing RSS parser drops authentication leakage while preserving external evidence', () => {
  const results = parseBingRss(`
    <rss><channel>
      <item>
        <title>Create your Microsoft account</title>
        <link>https://account.microsoft.com/account</link>
        <description>Sign up for an account.</description>
      </item>
      <item>
        <title>Occupational Health</title>
        <link>https://www.osha.gov/occupational-health</link>
        <description>Official guidance.</description>
      </item>
    </channel></rss>
  `)
  assert.equal(results.length, 1)
  assert.equal(results[0].domain, 'osha.gov')
})

test('DuckDuckGo Lite parser drops internal navigation and auth links', () => {
  const results = parseDuckDuckGoLite(`
    <html><body>
      <a class="result-link" href="https://login.live.com/">Sign in</a>
      <div class="result-snippet">Authentication</div>
      <a class="result-link" href="https://www.osha.gov/occupational-health">Occupational Health</a>
      <div class="result-snippet">Official occupational health guidance</div>
    </body></html>
  `)
  assert.equal(results.length, 1)
  assert.equal(results[0].url, 'https://www.osha.gov/occupational-health')
})
