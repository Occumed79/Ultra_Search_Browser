import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildQueryVariants,
  buildRetrievalTasks,
  searchCandidateLimit,
} from '../src/lib/search-planner'
import type { ExpandedQuery } from '../src/lib/intelligence'
import type { OperatorsResult } from '../src/lib/search-operators'
import type { SearchPlan } from '../src/lib/search-settings'

const operators: OperatorsResult = {
  cleanQuery: 'occupational health services RFP',
  includedSites: [],
  excludedSites: [],
  fileTypes: [],
  inUrlTerms: [],
  inTitleTerms: [],
  exactPhrases: [],
  requiredTerms: ['occupational', 'health', 'services', 'RFP'],
  excludedTerms: [],
  booleanMode: null,
}

const expanded: ExpandedQuery = {
  original: 'occupational health services RFP',
  lens: 'procurement',
  expansions: [
    'occupational health services RFP solicitation',
    'filetype:pdf occupational health services RFP',
    'occupational health services RFP 2026 currently open',
    'occupational health services RFP responses due 2026',
  ],
  withOperators: [
    'site:.gov "occupational health services RFP"',
    'site:sam.gov "occupational health services RFP"',
    'site:ionwave.net "occupational health services RFP"',
  ],
  synonyms: {},
}

const plan: SearchPlan = {
  liveSources: ['google', 'bing', 'duckduckgo'],
  useMemory: true,
  resultsPerPage: 20,
  autoSummarize: true,
  safeSearch: true,
  preferredLanguage: 'en',
  region: 'us',
}

test('procurement planning keeps full-query, official, document, freshness, and portal searches', () => {
  const variants = buildQueryVariants(
    'occupational health services RFP',
    'procurement',
    expanded,
    operators,
    2026
  )

  assert.equal(variants[0].purpose, 'broad')
  assert.ok(variants.some(variant => variant.query === '"occupational health services RFP"'))
  assert.ok(variants.some(variant => variant.purpose === 'official' && /site:\.gov/i.test(variant.query)))
  assert.ok(variants.some(variant => variant.purpose === 'document' && /filetype:pdf/i.test(variant.query)))
  assert.ok(variants.some(variant => variant.purpose === 'freshness' && /2026/i.test(variant.query)))
  assert.ok(variants.some(variant => variant.purpose === 'portal' && /sam\.gov/i.test(variant.query)))
  assert.ok(variants.length <= 7)
})

test('retrieval tasks send the full and protected queries to every selected engine', () => {
  const variants = buildQueryVariants(
    'occupational health services RFP',
    'procurement',
    expanded,
    operators,
    2026
  )
  const tasks = buildRetrievalTasks(variants, plan)

  const originalTasks = tasks.filter(task => task.query === 'occupational health services RFP')
  const protectedTasks = tasks.filter(task => task.query === '"occupational health services RFP"')
  assert.deepEqual(originalTasks.map(task => task.source), ['google', 'bing', 'duckduckgo'])
  assert.deepEqual(protectedTasks.map(task => task.source), ['google', 'bing', 'duckduckgo'])
  assert.ok(tasks.some(task => task.purpose === 'official'))
  assert.ok(tasks.some(task => task.purpose === 'document'))
  assert.ok(tasks.some(task => task.purpose === 'freshness'))
  assert.ok(tasks.some(task => task.purpose === 'portal'))
  assert.ok(tasks.length <= 14)
})

test('explicit site, filetype, phrase, and exclusion operators survive query planning', () => {
  const explicitOperators: OperatorsResult = {
    ...operators,
    cleanQuery: 'occupational health',
    includedSites: ['example.gov'],
    fileTypes: ['pdf'],
    exactPhrases: ['occupational health'],
    excludedTerms: ['archived'],
  }

  const variants = buildQueryVariants(
    'occupational health',
    'government',
    { ...expanded, lens: 'government' },
    explicitOperators,
    2026
  )

  assert.match(variants[0].query, /site:example\.gov/)
  assert.match(variants[0].query, /filetype:pdf/)
  assert.match(variants[0].query, /"occupational health"/)
  assert.match(variants[0].query, /-archived/)
  assert.equal(variants.filter(variant => variant.query === '"occupational health"').length, 0)
})

test('retrieval preserves a wider candidate pool until complete-query filtering', () => {
  assert.equal(searchCandidateLimit(10), 40)
  assert.equal(searchCandidateLimit(20), 60)
  assert.equal(searchCandidateLimit(40), 80)
  assert.equal(searchCandidateLimit(60), 80)
})
