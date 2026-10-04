import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateIntentRelevance } from '../src/lib/intent-relevance'
import { buildDeterministicSemanticIntent, parseGeminiIntentPayload } from '../src/lib/semantic-intent'
import { analyzeSearchIntent, classifyLocalCandidate } from '../src/lib/smart-filter'
import type { ScrapedResult } from '../src/types/search'
function result(overrides: Partial<ScrapedResult>): ScrapedResult {
  return { title: 'Untitled', url: 'https://example.com/result', description: '', domain: 'example.com', source: 'Bing', rank: 1, score: 50, ...overrides }
}
test('provider requests preserve literal subject and geography without injecting service aliases', () => {
  const plan = buildDeterministicSemanticIntent('Find quasar inspection clinics in Stuttgart')
  assert.equal(plan.intentKind, 'find-provider')
  assert.equal(plan.suggestedLens, 'provider')
  assert.ok(plan.geography.includes('Stuttgart'))
  assert.ok(plan.requiredConcepts.includes('quasar'))
  assert.ok(!plan.requiredConcepts.includes('find'))
  assert.ok(!plan.requiredConcepts.includes('clinics'))
})
test('explanatory requests stay broad and preserve literal concepts', () => {
  const plan = buildDeterministicSemanticIntent('What is the quasar inspection protocol?')
  assert.equal(plan.intentKind, 'explain')
  assert.equal(plan.suggestedLens, 'web')
  assert.ok(plan.requiredConcepts.includes('quasar'))
  assert.ok(plan.requiredConcepts.includes('protocol'))
})
test('pricing evidence and geography remain separate constraints', () => {
  const plan = buildDeterministicSemanticIntent('Find posted self-pay prices for quasar in Townsville')
  const relevance = evaluateIntentRelevance(plan, 'pricing', result({ title: 'Quasar fee schedule Townsville', description: 'Quasar inspection $95 cash price.' }))
  assert.equal(plan.intentKind, 'find-pricing')
  assert.equal(relevance.coverage, 1)
  assert.equal(relevance.taskEvidence, true)
})
test('procurement plans require opportunity evidence and the requested subject', () => {
  const plan = buildDeterministicSemanticIntent('Request for Proposal quasar services')
  const relevant = evaluateIntentRelevance(plan, 'procurement', result({ title: 'Quasar RFP', description: 'Proposals are due December 31, 2099.' }))
  const unrelated = evaluateIntentRelevance(plan, 'procurement', result({ title: 'Fleet Maintenance RFP', description: 'Solicitation for vehicle repairs.' }))
  assert.equal(plan.intentKind, 'find-procurement')
  assert.equal(relevant.coverage, 1)
  assert.ok(unrelated.coverage < relevant.coverage)
})
test('user source preferences and exclusions remain ranking constraints', () => {
  const plan = buildDeterministicSemanticIntent('Find quasar clinics within 65 miles of Memphis, official clinic websites only, no directories')
  const directory = evaluateIntentRelevance(plan, 'provider', result({ title: 'Quasar Provider Directory', description: 'Find a provider near Memphis.', url: 'https://directory.example/results' }))
  assert.match(directory.collisionReason || '', /directory|aggregator/i)
})
test('explicitly supplied intent aliases preserve complete request meaning', () => {
  const query = 'quasar clinics Stuttgart'
  const plan = parseGeminiIntentPayload(JSON.stringify({ conceptGroups: [{ id: 'quasar', label: 'quasar', terms: ['quasar', 'synthetic alternate'], kind: 'service', required: true }, { id: 'stuttgart', label: 'Stuttgart', terms: ['Stuttgart'], kind: 'geography', required: true }], intentKind: 'find-provider', requiredConcepts: ['quasar', 'Stuttgart'] }), query, 'provider')
  const intent = analyzeSearchIntent(query, 'provider', plan)
  const good = classifyLocalCandidate(query, 'provider', intent, result({ title: 'Synthetic alternate clinic Stuttgart' }))
  const unrelated = classifyLocalCandidate(query, 'provider', intent, result({ title: 'Fleet shop Stuttgart' }))
  assert.equal(good.status, 'valid')
  assert.equal(unrelated.status, 'rejected')
})
test('technical queries preserve framework and failure details', () => {
  const plan = buildDeterministicSemanticIntent('Next.js route handler AbortSignal timeout')
  assert.equal(plan.intentKind, 'technical')
  assert.deepEqual(plan.requiredConcepts, ['nextjs', 'route', 'handler', 'abortsignal', 'timeout'])
})
test('ordinary clinic searches route to providers without a hard-coded service', () => {
  const plan = buildDeterministicSemanticIntent('cardiology clinics near Eureka California')
  assert.equal(plan.intentKind, 'find-provider')
  assert.ok(plan.geography.includes('Eureka California'))
})
test('plain news requests route to current coverage', () => {
  assert.equal(buildDeterministicSemanticIntent('federal contractor news').intentKind, 'find-news')
})
