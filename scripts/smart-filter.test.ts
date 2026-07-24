import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeSearchIntent,
  applySmartFilter,
  classifyLocalCandidate,
} from '../src/lib/smart-filter'
import type { ScrapedResult } from '../src/types/search'

function result(overrides: Partial<ScrapedResult>): ScrapedResult {
  return {
    title: 'Untitled result',
    url: 'https://example.com/result',
    description: '',
    domain: 'example.com',
    source: 'Bing',
    rank: 1,
    score: 50,
    ...overrides,
  }
}

test('intent analysis protects every meaningful word in the full query', () => {
  const intent = analyzeSearchIntent('occupational health services Fresno')

  assert.deepEqual(intent.requiredConcepts, ['occupational', 'health', 'services', 'fresno'])
  assert.equal(intent.minimumRequiredMatches, 3)
  assert.ok(intent.exactPhrases.includes('occupational health'))
  assert.ok(intent.exactPhrases.includes('health services'))
})

test('a whole-query occupational health match is valid', () => {
  const query = 'occupational health services Fresno'
  const intent = analyzeSearchIntent(query)
  const decision = classifyLocalCandidate(query, 'provider', intent, result({
    title: 'Occupational Health Services in Fresno',
    description: 'Employer physicals, testing, and occupational medicine services in Fresno, California.',
    url: 'https://clinic.example/fresno-occupational-health',
    domain: 'clinic.example',
  }))

  assert.equal(decision.status, 'valid')
  assert.deepEqual(decision.matchedConcepts, ['occupational', 'health', 'services', 'fresno'])
})

test('a one-word occupational match is rejected', () => {
  const query = 'occupational health services Fresno'
  const intent = analyzeSearchIntent(query)
  const decision = classifyLocalCandidate(query, 'provider', intent, result({
    title: 'Occupational Therapy Careers',
    description: 'Browse open occupational therapist jobs throughout California.',
    url: 'https://jobs.example/occupational-therapy',
    domain: 'jobs.example',
  }))

  assert.equal(decision.status, 'rejected')
  assert.deepEqual(decision.matchedConcepts, ['occupational'])
})

test('technical retailer collisions do not pass the smart filter', () => {
  const query = 'Next.js route handler AbortSignal timeout'
  const intent = analyzeSearchIntent(query)
  const retailer = classifyLocalCandidate(query, 'technical', intent, result({
    title: 'Next: Shop Clothing and Homeware',
    description: 'Fashion, furniture, and accessories. Shop now.',
    url: 'https://www.next.example/shop',
    domain: 'next.example',
  }))

  assert.equal(retailer.status, 'rejected')
})

test('smart filter returns valid matches and removes weak candidates', async () => {
  const filtered = await applySmartFilter(
    'occupational health services Fresno',
    'provider',
    [
      result({
        title: 'Occupational Health Services in Fresno',
        description: 'Occupational medicine and employer health services in Fresno.',
        url: 'https://clinic.example/fresno',
        domain: 'clinic.example',
        score: 70,
      }),
      result({
        title: 'Occupational Therapy Jobs',
        description: 'Occupational therapist careers.',
        url: 'https://jobs.example/therapy',
        domain: 'jobs.example',
        score: 90,
      }),
    ],
    20,
    { useLocalTransformer: false }
  )

  assert.equal(filtered.results.length, 1)
  assert.equal(filtered.results[0].url, 'https://clinic.example/fresno')
  assert.equal(filtered.results[0].validation?.status, 'valid')
  assert.equal(filtered.diagnostics.rejectedCount, 1)
  assert.equal(filtered.diagnostics.mode, 'local-rules')
})

test('strict filtering fails open with a small uncertain review set', async () => {
  const filtered = await applySmartFilter(
    'occupational health services Fresno',
    'provider',
    [
      result({
        title: 'Occupational Therapy',
        description: 'General therapy information.',
        url: 'https://example.com/therapy',
      }),
    ],
    20,
    { useLocalTransformer: false }
  )

  assert.equal(filtered.results.length, 1)
  assert.equal(filtered.results[0].validation?.status, 'uncertain')
  assert.match(filtered.results[0].validation?.reason ?? '', /Nothing passed the strict full-query filter/)
})
