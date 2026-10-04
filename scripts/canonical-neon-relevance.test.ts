import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { profileRows } from './fixtures/canonical-profile'
import { buildProfile, getRelevanceProfile, setRelevanceProfile } from '../src/lib/canonical/search/relevanceProfile'
import { PROFILE_SQL, refreshRelevanceProfile, type QueryFn } from '../src/lib/canonical/occumedAware/relevanceProfileLoader'
import { readProfileCache, writeProfileCache, cachePath } from '../src/lib/canonical/occumedAware/relevanceProfileCache'
import { assessCanonicalRelevance, canonicalBuyerTerms } from '../src/lib/canonical-relevance'
import { evaluateCanonicalResult, applyCanonicalDecisionGate } from '../src/lib/canonical-result-decision'
import { normalizeBrowserSerpCandidates, buildBrowserSearchPlan } from '../src/lib/browser-search-pipeline'
import { processSearchCandidates } from '../src/lib/search-candidate-processing'
import { deepValidateResults, type DeepValidationOutcome } from '../src/lib/deep-validation'
import { classifyResultStatus } from '../src/lib/result-status'
import { federalRegisterTargets } from '../src/lib/federal-register-index'
import { pruneNonOccuMedEntries } from '../src/lib/index-prune'
import type { ScrapedResult, ResultLifecycleStatus } from '../src/types/search'

const originalFetch = globalThis.fetch
const originalUrl = process.env.OCCU_MED_AWARE_DATABASE_URL
const originalCache = process.env.RELEVANCE_PROFILE_CACHE_PATH
const testDirectory = mkdtempSync(path.join(tmpdir(), 'ultra-profile-test-'))
afterEach(() => {
  setRelevanceProfile(null)
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.OCCU_MED_AWARE_DATABASE_URL
  else process.env.OCCU_MED_AWARE_DATABASE_URL = originalUrl
  if (originalCache === undefined) delete process.env.RELEVANCE_PROFILE_CACHE_PATH
  else process.env.RELEVANCE_PROFILE_CACHE_PATH = originalCache
})
process.on('exit', () => rmSync(testDirectory, { recursive: true, force: true }))
function publish(service?: string) { assert.equal(setRelevanceProfile(buildProfile(profileRows(service), 'neon')).applied, true) }
function candidate(status: ResultLifecycleStatus = 'open'): ScrapedResult {
  return {
    title: 'Quasar inspection RFP', description: 'RFP for quasar inspection. Responses due December 31, 2099.',
    content: 'RFP for quasar inspection. Responses due December 31, 2099.',
    url: 'https://sample.gov/procurement/record', domain: 'sample.gov', source: 'SearXNG', rank: 1, score: 50,
    validation: { status: 'valid', relevance: 0.8, reason: 'Generic query matched', matchedConcepts: [], mode: 'local-rules' },
    pageValidation: { checkedAt: new Date().toISOString(), requestedUrl: 'https://sample.gov/procurement/record', finalUrl: 'https://sample.gov/procurement/record', availability: 'reachable', reason: 'Page opened', evidence: [], extractedTextLength: 500, cached: false, lifecycle: { status, reason: status, confidence: 0.9, dates: [] } },
  }
}

test('loader reads all canonical Neon tables without row caps and exposes a version', async () => {
  const rows = profileRows()
  const calls: string[] = []
  const query: QueryFn = async <T>(sql: string) => {
    calls.push(sql)
    const key = (Object.keys(PROFILE_SQL) as Array<keyof typeof PROFILE_SQL>).find(key => PROFILE_SQL[key] === sql)!
    return rows[key] as T[]
  }
  const loaded = await refreshRelevanceProfile(query)
  assert.equal(loaded.applied, true)
  assert.equal(loaded.source, 'neon')
  assert.equal(calls.length, 4)
  assert.ok(calls.every(sql => /occumed_core\./.test(sql) && !/\bLIMIT\b/i.test(sql)))
  assert.match(loaded.version, /^[a-f0-9]{64}$/)
  assert.equal(assessCanonicalRelevance({ title: 'Quasar inspection RFP' }).verdict, 'accept')
})

test('changing only database rows changes relevance, buyer suggestions and feed targeting', () => {
  publish()
  assert.equal(assessCanonicalRelevance({ title: 'Quasar inspection RFP' }).verdict, 'accept')
  assert.ok(canonicalBuyerTerms('quasar inspection rfp').includes('quasar inspection'))
  assert.ok(federalRegisterTargets().some(target => target.term === '"quasar inspection"'))
  publish('violet analysis')
  assert.equal(assessCanonicalRelevance({ title: 'Quasar inspection RFP' }).verdict, 'reject')
  assert.equal(assessCanonicalRelevance({ title: 'Violet analysis RFP' }).verdict, 'accept')
  assert.ok(federalRegisterTargets().every(target => !target.term?.includes('quasar')))
})

test('thresholds and exclusions come from rows; classification code cannot override a rule rejection', () => {
  const rows = profileRows()
  rows.facts.find(fact => fact.predicate === 'relevance.accept_min')!.value_numeric = 91
  setRelevanceProfile(buildProfile(rows, 'neon'))
  const accepted = assessCanonicalRelevance({ title: 'Quasar inspection RFP' })
  assert.equal(accepted.score, 91)
  assert.equal(accepted.thresholds.acceptMin, 91)
  assert.equal(assessCanonicalRelevance({ title: 'Other RFP', naics: '123456' }).discovery?.code, '123456')
  assert.equal(assessCanonicalRelevance({ title: 'Quasar inspection RFP forbidden-widget', naics: '123456' }).verdict, 'reject')
})

test('identical evidence has identical verdict for every retrieval provider and ranking score', () => {
  publish()
  const verdicts = ['SearXNG', 'Keenable', 'TinyFish', 'Tavily', 'Exa', 'LangSearch', 'memory'].map((source, index) => evaluateCanonicalResult({ ...candidate(), source, score: index * 15, retrieval: { sources: [source], queries: ['quasar'], purposes: ['broad'], overlap: index + 1 } }))
  assert.ok(verdicts.every(verdict => verdict.decision === 'SHOW' && verdict.relevance.score === verdicts[0].relevance.score && verdict.profileVersion === verdicts[0].profileVersion))
})

test('missing or incomplete profile holds relevance for review instead of accepting or discarding it', async () => {
  setRelevanceProfile(null)
  assert.equal(evaluateCanonicalResult(candidate()).decision, 'REVIEW')
  const query: QueryFn = async <T>() => [] as T[]
  const load = await refreshRelevanceProfile(query)
  assert.equal(load.applied, false)
  assert.equal(getRelevanceProfile().source, 'unavailable')
  assert.equal(assessCanonicalRelevance({ title: 'Quasar inspection RFP' }).verdict, 'review')
})

test('verified cache uses only fetched rows, rejects tampering and expiry, and supports outage recovery', async () => {
  process.env.OCCU_MED_AWARE_DATABASE_URL = 'postgres://synthetic:test@localhost/test'
  process.env.RELEVANCE_PROFILE_CACHE_PATH = path.join(testDirectory, 'profile.json')
  assert.equal(writeProfileCache(profileRows()), true)
  assert.equal(readProfileCache().ok, true)
  const outage: QueryFn = async () => { throw new Error('simulated database outage') }
  const load = await refreshRelevanceProfile(outage)
  assert.equal(load.source, 'cache')
  const file = JSON.parse(readFileSync(cachePath(), 'utf8'))
  file.rows.terms[0].phrase = 'tampered'
  writeFileSync(cachePath(), JSON.stringify(file))
  assert.equal(readProfileCache().ok, false)
  writeProfileCache(profileRows(), Date.now() - 8 * 24 * 60 * 60_000)
  assert.equal(readProfileCache().ok, false)
})

test('generic query planning and retrieval normalization work without a profile', async () => {
  const plan = buildBrowserSearchPlan('quasar inspection RFP')
  assert.ok(plan.searches.length >= 4)
  const results = normalizeBrowserSerpCandidates([{ title: 'Quasar inspection RFP', url: 'https://sample.gov/procurement/record', description: 'RFP for quasar inspection', source: 'Exa' }])
  const processed = await processSearchCandidates({ query: 'quasar inspection RFP', results, transport: 'fixture', retrievalMode: 'test', productMode: 'test', persist: false })
  assert.equal(processed.results.length, 1)
  assert.equal(processed.results[0].retrieval?.sources[0], 'Exa')
})

test('page retrieval still opens evidence and missing profile returns review', async () => {
  globalThis.fetch = async () => new Response(`<html><head><title>Quasar inspection RFP</title></head><body><h1>Quasar inspection RFP</h1><p>Responses due December 31, 2099.</p><p>${'Request for proposals for quasar inspection. '.repeat(30)}</p></body></html>`, { headers: { 'content-type': 'text/html' } })
  const result = candidate()
  result.url = 'https://sample.gov/procurement/integration-record'
  delete result.pageValidation
  const outcome = await deepValidateResults('quasar inspection RFP', 'procurement', [result], { maxTargets: 1 })
  assert.equal(outcome.buckets.uncertain.length, 1)
  assert.equal(outcome.buckets.uncertain[0].pageValidation?.availability, 'reachable')
  assert.equal((outcome.buckets.uncertain[0] as any).canonicalDecision.profileSource, 'unavailable')
})

test('final lifecycle states remain rejected regardless of canonical service match', () => {
  publish()
  for (const state of ['expired', 'closed', 'cancelled', 'awarded', 'stale'] as const) assert.equal(evaluateCanonicalResult(candidate(state)).decision, 'REJECT')
  assert.equal(classifyResultStatus('Quasar inspection RFP. Responses due January 1, 2020.', 'procurement').status, 'expired')
})

test('canonical gate preserves dedupe buckets and generic evidence rejection', () => {
  publish()
  const kept = candidate()
  const duplicate = { ...kept, url: 'https://sample.gov/files/duplicate', bucket: 'duplicate' as const }
  const outcome = { results: [kept], buckets: { valid: [kept], uncertain: [], expired: [], dead: [], rejected: [], duplicate: [duplicate] }, progress: { phase: 'complete', total: 2, checked: 2, reachable: 2, valid: 1, uncertain: 0, expired: 0, dead: 0, rejected: 0, duplicates: 1 }, diagnostics: {} } as unknown as DeepValidationOutcome
  const gated = applyCanonicalDecisionGate(outcome)
  assert.equal(gated.buckets.duplicate.length, 1)
  assert.equal(gated.results.length, 1)
  assert.equal(evaluateCanonicalResult({ ...kept, validation: { ...kept.validation!, status: 'rejected' } }).decision, 'REJECT')
})

test('all tracked production directories have no legacy relevance authority or service vocabulary literals', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const forbiddenModules = ['occumed-rfp-profile', 'occumed-capability-matching', 'occumed-smart-filter', 'occumed-historical-pursuits', 'occumed-index-filters']
  function walk(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.next' ? [] : entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
  }
  for (const file of walk(path.join(root, 'src'))) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    assert.ok(!forbiddenModules.some(module => source.includes(module)), file)
    // Comments/examples do not constitute a vocabulary; executable lists and regexes do.
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(executable, /(?:occupational health\||occupational medicine\||drug testing\||spirometry\||\['occupational health'|OCCUMED_(?:NAICS|CAPABILITY|HARD_EXCLUSION|VERIFIED_AWARD)|BROAD_OCCUMED_SERVICE_QUERY)/, file)
  }
})


test('pruning cannot delete data when canonical relevance is unavailable', async () => {
  delete process.env.OCCU_MED_AWARE_DATABASE_URL
  setRelevanceProfile(null)
  await assert.rejects(pruneNonOccuMedEntries(), /Canonical relevance profile unavailable; pruning disabled/)
})

test('profile-derived synonyms remain usable in query planning and retrieval filtering', async () => {
  const rows = profileRows()
  rows.terms.push({ ...rows.terms[0], phrase: 'violet assessment' })
  setRelevanceProfile(buildProfile(rows, 'neon'))
  const plan = buildBrowserSearchPlan('quasar inspection RFP')
  assert.ok(plan.searches.some(search => search.query.includes('violet assessment')))
  const processed = await processSearchCandidates({ query: 'quasar inspection RFP', results: [{ title: 'Violet assessment RFP', url: 'https://sample.gov/procurement/aliases', description: 'RFP for violet assessment', source: 'LangSearch' }], intent: plan.intent, transport: 'fixture', retrievalMode: 'test', productMode: 'test', persist: false })
  assert.equal(processed.results.length, 1)
  assert.equal(processed.results[0].source, 'LangSearch')
})

test('Neon transport uses the dedicated profile URL and never writes schema or seeds', () => {
  const db = readFileSync(new URL('../src/lib/canonical/occumedAware/db.ts', import.meta.url), 'utf8')
  const loader = readFileSync(new URL('../src/lib/canonical/occumedAware/relevanceProfileLoader.ts', import.meta.url), 'utf8')
  assert.match(db, /process\.env\.OCCU_MED_AWARE_DATABASE_URL/)
  assert.doesNotMatch(db, /process\.env\.DATABASE_URL\b/)
  assert.doesNotMatch(loader, /\b(?:INSERT INTO|UPDATE occumed_core|CREATE TABLE|DELETE FROM)\b/i)
})
