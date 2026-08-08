import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateIntentRelevance } from '../src/lib/intent-relevance'
import {
  buildDeterministicSemanticIntent,
  type SemanticIntentPlan,
} from '../src/lib/semantic-intent'
import { analyzeSearchIntent, classifyLocalCandidate } from '../src/lib/smart-filter'
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

function labels(plan: SemanticIntentPlan): string[] {
  return plan.conceptGroups.filter(group => group.required).map(group => group.label)
}

test('provider requests become grouped tasks instead of bags of words', () => {
  const plan = buildDeterministicSemanticIntent(
    'Find occupational health clinics in Stuttgart that offer pure-tone audiograms'
  )

  assert.equal(plan.intentKind, 'find-provider')
  assert.equal(plan.suggestedLens, 'provider')
  assert.deepEqual(labels(plan), [
    'occupational health',
    'pure-tone audiogram',
    'Stuttgart',
  ])
  assert.ok(!plan.requiredConcepts.includes('find'))
  assert.ok(!plan.requiredConcepts.includes('clinics'))
  assert.ok(plan.searchVariants.some(variant =>
    /occupational medicine/i.test(variant)
    && /audiogram|audiometry|hearing test/i.test(variant)
    && /stuttgart/i.test(variant)
  ))
})

test('an explanatory medical query stays broad instead of becoming a provider hunt', () => {
  const plan = buildDeterministicSemanticIntent(
    'What is the Bruce protocol for a treadmill stress test?'
  )

  assert.equal(plan.intentKind, 'explain')
  assert.equal(plan.suggestedLens, 'web')
  assert.deepEqual(labels(plan), ['treadmill stress test', 'Bruce protocol'])
})

test('pricing searches preserve price evidence, service aliases, and location separately', () => {
  const plan = buildDeterministicSemanticIntent(
    'Find posted self-pay prices for PFT in Townsville'
  )

  assert.equal(plan.intentKind, 'find-pricing')
  assert.equal(plan.suggestedLens, 'pricing')
  assert.deepEqual(labels(plan), [
    'posted pricing',
    'pulmonary function test',
    'Townsville',
  ])

  const relevance = evaluateIntentRelevance(plan, 'pricing', result({
    title: 'Occupational Medicine Fee Schedule – Townsville',
    description: 'Spirometry $95 cash price. Self-pay patients welcome.',
    url: 'https://clinic.example/townsville-fees',
    domain: 'clinic.example',
  }))
  assert.equal(relevance.matchedGroups.length, 3)
  assert.equal(relevance.taskEvidence, true)
  assert.equal(relevance.coverage, 1)
})

test('procurement searches require both the opportunity and its subject', () => {
  const plan = buildDeterministicSemanticIntent(
    'Request for Proposal occupational health services'
  )
  assert.equal(plan.intentKind, 'find-procurement')
  assert.deepEqual(labels(plan), ['occupational health', 'procurement opportunity'])

  const relevant = evaluateIntentRelevance(plan, 'procurement', result({
    title: 'RFP – Occupational Health Services',
    description: 'Proposals are due August 28, 2026.',
    url: 'https://county.gov/procurement/occupational-health-rfp.pdf',
    domain: 'county.gov',
  }))
  const unrelated = evaluateIntentRelevance(plan, 'procurement', result({
    title: 'Fleet Maintenance RFP',
    description: 'Open solicitation for vehicle repairs.',
    url: 'https://county.gov/procurement/fleet-rfp.pdf',
    domain: 'county.gov',
  }))

  assert.equal(relevant.coverage, 1)
  assert.ok(unrelated.coverage < relevant.coverage)
})

test('source and exclusion instructions remain ranking constraints', () => {
  const plan = buildDeterministicSemanticIntent(
    'Find treadmill stress test providers within 65 miles of Memphis, official clinic websites only, no directories'
  )

  assert.equal(plan.intentKind, 'find-provider')
  assert.ok(plan.geography.includes('Memphis'))
  assert.ok(plan.exclusions.some(value => /directories/i.test(value)))
  assert.ok(plan.sourcePreferences.includes('official provider pages'))

  const directory = evaluateIntentRelevance(plan, 'provider', result({
    title: 'Top 10 Cardiac Stress Test Providers Directory',
    description: 'Find a provider near Memphis.',
    url: 'https://directory.example/memphis-stress-tests',
    domain: 'directory.example',
  }))
  assert.match(directory.collisionReason || '', /directory|aggregator/i)
})

test('complete provider capability beats a generic specialty result', () => {
  const query = 'occupational health clinic pure-tone audiogram Stuttgart'
  const plan = buildDeterministicSemanticIntent(query)
  const intent = analyzeSearchIntent(query, 'provider', plan)

  const clinic = classifyLocalCandidate(query, 'provider', intent, result({
    title: 'Arbeitsmedizin Stuttgart',
    description: 'Occupational medicine clinic offering Audiometrie and employer hearing tests in Stuttgart.',
    url: 'https://arbeitsmedizin.example/stuttgart/audiometrie',
    domain: 'arbeitsmedizin.example',
  }))
  const retailer = classifyLocalCandidate(query, 'provider', intent, result({
    title: 'Hearing Aids Stuttgart',
    description: 'Shop hearing aids and book a retail hearing screening.',
    url: 'https://hearing-shop.example/stuttgart',
    domain: 'hearing-shop.example',
  }))

  assert.equal(clinic.status, 'valid')
  assert.equal(retailer.status, 'rejected')
})

test('technical queries preserve framework and failure details', () => {
  const plan = buildDeterministicSemanticIntent(
    'Next.js route handler AbortSignal timeout'
  )
  assert.equal(plan.intentKind, 'technical')
  assert.equal(plan.suggestedLens, 'technical')
  assert.deepEqual(labels(plan), ['nextjs', 'route', 'handler', 'abortsignal', 'timeout'])
})

test('ordinary medical clinic searches route as provider tasks without a hard-coded service', () => {
  const plan = buildDeterministicSemanticIntent('cardiology clinics near Eureka California')
  assert.equal(plan.intentKind, 'find-provider')
  assert.equal(plan.suggestedLens, 'provider')
  assert.ok(labels(plan).includes('cardiology'))
  assert.ok(labels(plan).some(label => /Eureka California/i.test(label)))
})

test('plain news requests route to current coverage', () => {
  const plan = buildDeterministicSemanticIntent('federal contractor news')
  assert.equal(plan.intentKind, 'find-news')
  assert.equal(plan.suggestedLens, 'news')
})
