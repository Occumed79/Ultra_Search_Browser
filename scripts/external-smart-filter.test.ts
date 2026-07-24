import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeProviderDecisions,
  parseProviderPayload,
} from '../src/lib/external-smart-filter'

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
