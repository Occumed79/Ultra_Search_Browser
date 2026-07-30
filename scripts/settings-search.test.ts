import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGroundedSummary,
  buildSearchPlan,
  collectSettledSearchJobs,
  filterSafeResults,
  normalizeUserSettings,
} from '../src/lib/search-settings'
import type { ScrapedResult } from '../src/types/search'

const result = (title: string, url: string, source = 'Google'): ScrapedResult => ({
  title,
  url,
  description: `${title} description`,
  domain: new URL(url).hostname,
  source,
  rank: 1,
  score: 100,
})

test('normalizes persisted settings and removes decorative unsupported sources', () => {
  const settings = normalizeUserSettings({
    defaultSources: ['google', 'wikipedia', 'github', 'memory'],
    resultsPerPage: 999,
    safeSearch: false,
  })
  assert.deepEqual(settings.defaultSources, ['google', 'memory'])
  assert.equal(settings.resultsPerPage, 60)
  assert.equal(settings.safeSearch, false)
})

test('migrates the fragile legacy default source mix to independent indexes', () => {
  const settings = normalizeUserSettings({
    defaultSources: ['google', 'bing', 'duckduckgo', 'memory'],
  })
  assert.deepEqual(settings.defaultSources, ['bing', 'duckduckgo', 'brave', 'mojeek', 'memory'])
})

test('preserves a custom public source selection exactly', () => {
  const settings = normalizeUserSettings({
    defaultSources: ['brave', 'yahoo'],
  })
  assert.deepEqual(settings.defaultSources, ['brave', 'yahoo'])
})

test('builds an engine plan from the exact selected sources', () => {
  const plan = buildSearchPlan({ defaultSources: ['bing', 'searxng'], safeSearch: true })
  assert.deepEqual(plan.liveSources, ['bing', 'searxng'])
  assert.equal(plan.useMemory, false)
  assert.equal(plan.safeSearch, true)
})

test('keeps successful engine results when an optional source fails', () => {
  const settled: PromiseSettledResult<{ engine: string; query: string; data: { text: string; results: ScrapedResult[] } }>[] = [
    { status: 'fulfilled', value: { engine: 'Bing', query: 'clinic', data: { text: 'clinic result text', results: [result('Clinic', 'https://clinic.example')] } } },
    { status: 'rejected', reason: new Error('SearXNG unavailable') },
  ]
  const collected = collectSettledSearchJobs(settled)
  assert.equal(collected.results.length, 1)
  assert.equal(collected.failures.length, 1)
  assert.match(collected.failures[0], /SearXNG unavailable/)
})

test('safe search removes explicit result metadata while off preserves it', () => {
  const results = [
    result('Occupational medicine clinic', 'https://clinic.example'),
    result('Explicit porn videos', 'https://xxx.example'),
  ]
  assert.equal(filterSafeResults(results, true).length, 1)
  assert.equal(filterSafeResults(results, false).length, 2)
})

test('grounded summaries cite actual ranked titles and domains only when enabled', () => {
  const results = [result('County occupational health bid', 'https://county.gov/bid', 'Bing')]
  const summary = buildGroundedSummary('occupational health bid', 'procurement', results, true)
  assert.match(summary ?? '', /County occupational health bid/)
  assert.match(summary ?? '', /county\.gov/)
  assert.equal(buildGroundedSummary('query', 'web', results, false), undefined)
})
