import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  externalSmartFilterCapabilities,
  mergeProviderDecisions,
  parseProviderPayload,
  runExternalSmartFilterPool,
} from '../src/lib/external-smart-filter'
import { resetProviderKeyPoolForTests } from '../src/lib/provider-key-pool'

const originalFetch = globalThis.fetch
const originalCerebrasKey = process.env.CEREBRAS_API_KEY
const originalCerebrasKey2 = process.env.CEREBRAS_API_KEY_2
const originalGroqKey = process.env.GROQ_API_KEY

function restoreEnvironment() {
  globalThis.fetch = originalFetch
  if (originalCerebrasKey === undefined) delete process.env.CEREBRAS_API_KEY
  else process.env.CEREBRAS_API_KEY = originalCerebrasKey
  if (originalCerebrasKey2 === undefined) delete process.env.CEREBRAS_API_KEY_2
  else process.env.CEREBRAS_API_KEY_2 = originalCerebrasKey2
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = originalGroqKey
  resetProviderKeyPoolForTests()
}

afterEach(restoreEnvironment)

test('parses structured provider decisions and ignores unknown candidate ids', () => {
  const parsed = parseProviderPayload(JSON.stringify({
    interpretation: 'Find providers offering occupational health services.',
    decisions: [
      { id: 0, status: 'valid', relevance: 0.94, reason: 'Matches the complete service phrase.' },
      { id: 1, status: 'rejected', relevance: 0.08, reason: 'Only matches occupational.' },
      { id: 99, status: 'valid', relevance: 1, reason: 'Unknown candidate.' },
    ],
  }), new Set([0, 1]))

  assert.equal(parsed.decisions.size, 2)
  assert.equal(parsed.decisions.get(0)?.status, 'valid')
  assert.equal(parsed.decisions.get(1)?.status, 'rejected')
  assert.equal(parsed.decisions.has(99), false)
})

test('accepts fenced JSON from providers using JSON object mode', () => {
  const parsed = parseProviderPayload(`\`\`\`json
  {"interpretation":"Technical documentation","decisions":[{"id":2,"status":"uncertain","relevance":0.55,"reason":"The snippet is incomplete."}]}
  \`\`\``, new Set([2]))

  assert.equal(parsed.interpretation, 'Technical documentation')
  assert.equal(parsed.decisions.get(2)?.status, 'uncertain')
})

test('Groq fallback and reviewer use independent model variables', () => {
  const capabilities = externalSmartFilterCapabilities({
    GROQ_API_KEY: 'test-key',
    GROQ_SMART_MODEL: 'openai/gpt-oss-20b',
    GROQ_REVIEW_MODEL: 'openai/gpt-oss-120b',
  })

  assert.equal(capabilities.groq.configured, true)
  assert.equal(capabilities.groq.smartModel, 'openai/gpt-oss-20b')
  assert.equal(capabilities.groq.reviewModel, 'openai/gpt-oss-120b')
})

test('Groq roles receive distinct defaults when only the key is configured', () => {
  const capabilities = externalSmartFilterCapabilities({ GROQ_API_KEY: 'test-key' })

  assert.equal(capabilities.groq.smartModel, 'openai/gpt-oss-20b')
  assert.equal(capabilities.groq.reviewModel, 'openai/gpt-oss-120b')
})

test('Cerebras capability recognizes the second pool key even when key one is absent', () => {
  const capabilities = externalSmartFilterCapabilities({ CEREBRAS_API_KEY_2: 'second-key' })

  assert.equal(capabilities.cerebras.configured, true)
  assert.equal(capabilities.cerebras.keyCount, 1)
})

test('Cerebras retries the second pool key in the same review when the first key fails', async () => {
  delete process.env.GROQ_API_KEY
  process.env.CEREBRAS_API_KEY = 'cerebras-one'
  process.env.CEREBRAS_API_KEY_2 = 'cerebras-two'
  resetProviderKeyPoolForTests()

  const authorizations: string[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get('Authorization') || ''
    authorizations.push(authorization)

    if (authorization === 'Bearer cerebras-one') {
      return new Response('quota reached', { status: 429 })
    }

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            interpretation: 'Open occupational health procurement.',
            decisions: [{
              id: 0,
              status: 'valid',
              relevance: 0.95,
              reason: 'The result is an active occupational-health solicitation.',
            }],
          }),
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const outcome = await runExternalSmartFilterPool(
    'occupational health RFP',
    'procurement',
    {
      originalQuery: 'occupational health RFP',
      interpretation: 'Find active occupational health procurements.',
      requiredConcepts: ['occupational health', 'procurement'],
      exactPhrases: ['occupational health'],
      minimumRequiredMatches: 1,
    },
    [{
      title: 'Occupational Health Services RFP',
      url: 'https://example.gov/rfp/123',
      description: 'Open solicitation for occupational health medical services.',
      domain: 'example.gov',
      source: 'SearXNG · google',
      rank: 1,
      score: 90,
    }],
    [{
      status: 'valid',
      relevance: 0.9,
      matchedConcepts: ['occupational health', 'procurement'],
    }]
  )

  assert.deepEqual(authorizations, ['Bearer cerebras-one', 'Bearer cerebras-two'])
  assert.equal(outcome.used, true)
  assert.equal(outcome.mode, 'cerebras')
  assert.equal(outcome.decisions.get(0)?.status, 'valid')
  assert.equal(outcome.attempts.length, 2)
  assert.equal(outcome.attempts[0].status, 'failed')
  assert.equal(outcome.attempts[1].status, 'success')
})

test('agreement averages provider confidence', () => {
  const merged = mergeProviderDecisions(
    { id: 3, status: 'valid', relevance: 0.8, reason: 'Cerebras reason.' },
    { id: 3, status: 'valid', relevance: 0.9, reason: 'Groq reason.' }
  )

  assert.equal(merged.status, 'valid')
  assert.equal(merged.relevance, 0.85)
  assert.equal(merged.reason, 'Groq reason.')
})

test('direct valid-versus-rejected disagreement remains visible as uncertain', () => {
  const merged = mergeProviderDecisions(
    { id: 4, status: 'valid', relevance: 0.84, reason: 'Cerebras says valid.' },
    { id: 4, status: 'rejected', relevance: 0.18, reason: 'Groq says unrelated.' }
  )

  assert.equal(merged.status, 'uncertain')
  assert.match(merged.reason, /disagreed/i)
})

test('reviewer resolves an uncertain primary classification', () => {
  const merged = mergeProviderDecisions(
    { id: 5, status: 'uncertain', relevance: 0.5, reason: 'Insufficient evidence.' },
    { id: 5, status: 'rejected', relevance: 0.12, reason: 'Generic homepage.' }
  )

  assert.equal(merged.status, 'rejected')
  assert.equal(merged.reason, 'Generic homepage.')
})
