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

test('intent analysis protects meaning-bearing groups instead of filler words', () => {
  const intent = analyzeSearchIntent('occupational health services Fresno')

  assert.deepEqual(intent.requiredConcepts, ['occupational health', 'fresno'])
  assert.equal(intent.minimumRequiredMatches, 2)
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
  assert.deepEqual(decision.matchedConcepts, ['occupational health', 'fresno'])
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
  assert.deepEqual(decision.matchedConcepts, [])
})

test('occupational medicine clinic language satisfies occupational health services intent', () => {
  const query = 'occupational health services'
  const intent = analyzeSearchIntent(query)
  const decision = classifyLocalCandidate(query, 'web', intent, result({
    title: 'Occupational Medicine Clinic',
    description: 'Employer medical testing and workplace medicine.',
    url: 'https://clinic.example/occupational-medicine',
    domain: 'clinic.example',
  }))

  assert.equal(decision.status, 'valid')
  assert.deepEqual(decision.matchedConcepts, ['occupational health'])
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

test('strict filtering returns no ranked results when every candidate is junk', async () => {
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

  assert.equal(filtered.results.length, 0)
  assert.equal(filtered.diagnostics.rejectedCount, 1)
})

test('one-word dictionary matches do not fill the page behind relevant results', async () => {
  const filtered = await applySmartFilter(
    'occupational health services',
    'web',
    [
      result({
        title: 'Occupational Health Services',
        description: 'Employer medical testing and occupational medicine services.',
        url: 'https://clinic.example/services',
        score: 70,
      }),
      result({
        title: 'OCCUPATIONAL Definition & Meaning',
        description: 'The meaning of occupational is relating to a job.',
        url: 'https://dictionary.example/occupational',
        domain: 'dictionary.example',
        score: 90,
      }),
    ],
    20,
    { useLocalTransformer: false }
  )

  assert.deepEqual(filtered.results.map(item => item.url), ['https://clinic.example/services'])
  assert.equal(filtered.diagnostics.rejectedCount, 1)
})
