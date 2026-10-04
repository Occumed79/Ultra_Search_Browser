import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { profileRows } from './fixtures/canonical-profile'
import { buildProfile, getRelevanceProfile, setRelevanceProfile } from '../src/lib/canonical/search/relevanceProfile'
import { buildBrowserSearchPlan, normalizeBrowserSerpCandidates } from '../src/lib/browser-search-pipeline'
import { applyCanonicalDecisionGate, evaluateCanonicalResult } from '../src/lib/canonical-result-decision'
import { inspectPageSignals } from '../src/lib/page-validation'
import { deepValidateResults, type DeepValidationOutcome } from '../src/lib/deep-validation'
import { planAdaptiveResearch, researchSnapshot, researchNovelty, allocateProviderQueries, normalizeResearchQuery, RESEARCH_LIMITS, type ResearchResult } from '../src/lib/adaptive-research-planner'
import { continueAdaptiveResearch, mergeResearchOutcomes } from '../src/lib/adaptive-research'
import { executeSearchRetrieval } from '../src/lib/search-retrieval'
import { createSearchTrace, getSearchFlightRecord } from '../src/lib/search-flight-recorder'
import { resetSearchSourceHealthForTests } from '../src/lib/search-source-health'
import type { ScrapedResult, ResultBucket } from '../src/types/search'

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }
afterEach(() => {
  setRelevanceProfile(null)
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  resetSearchSourceHealthForTests()
})
function publish() { setRelevanceProfile(buildProfile(profileRows(), 'neon')) }
function result(id = '26-101', overrides: Partial<ResearchResult> = {}): ResearchResult {
  const url = `https://city.example.gov/procurement/${id}`
  const text = 'City of Example Request for proposals for quasar inspection. Responses due December 31, 2099.'
  const base: ResearchResult = {
    title: 'City of Example Quasar Inspection RFP', url, domain: 'city.example.gov', description: text,
    content: text, source: 'SearXNG', rank: 1, score: 50, bucket: 'valid',
    retrieval: { sources: ['SearXNG'], queries: ['quasar inspection'], purposes: ['official'], overlap: 1 },
    validation: { status: 'valid', relevance: 1, reason: 'Query evidence matched', matchedConcepts: [], mode: 'local-rules' },
    pageValidation: { checkedAt: new Date().toISOString(), requestedUrl: url, finalUrl: url, availability: 'reachable', reason: 'Procurement document opened', evidence: [text], extractedTextLength: 500, cached: false, contentType: 'text/html', lifecycle: { status: 'open', reason: 'Future deadline', confidence: 1, dates: [] } },
    rfpIntelligence: { opportunityKey: id, organization: 'City of Example', solicitationNumber: id, opportunityType: 'RFP', title: 'City of Example Quasar Inspection RFP', status: 'open', serviceSummary: [], mandatoryCredentials: [], procurementContacts: [], deliveryModel: 'unknown', fitScore: 0, fitBand: 'review', matchedCapabilities: [], matchedBuyerSegments: [], concerns: [], evidence: [text], documentUrls: [url], attachmentCount: 0, confidence: 1 },
    ...overrides,
  }
  base.canonicalDecision = evaluateCanonicalResult(base)
  return base
}
function outcome(results: ScrapedResult[], bucket: ResultBucket = 'valid'): DeepValidationOutcome {
  const buckets = { valid: [], uncertain: [], expired: [], dead: [], rejected: [], duplicate: [] } as DeepValidationOutcome['buckets']
  buckets[bucket] = results
  return {
    results: ['valid', 'uncertain'].includes(bucket) ? results : [], buckets,
    progress: { phase: 'complete', total: results.length, checked: results.length, reachable: results.length, valid: buckets.valid.length, uncertain: buckets.uncertain.length, expired: buckets.expired.length, dead: buckets.dead.length, rejected: buckets.rejected.length, duplicates: buckets.duplicate.length },
    diagnostics: { runtimeMs: 0, validationTargets: results.length, pageCache: { entries: 0, ttlMs: 0 } as DeepValidationOutcome['diagnostics']['pageCache'], smartFilter: {} as DeepValidationOutcome['diagnostics']['smartFilter'], duplicateCount: 0, adaptiveValidation: {} as DeepValidationOutcome['diagnostics']['adaptiveValidation'] },
  }
}
function batch(results: ResearchResult[], plan: Parameters<typeof executeSearchRetrieval>[0]) {
  return { results: results.map(item => ({ title: item.title, url: item.url, description: item.description, source: item.source, score: item.score, rank: item.rank, query: plan.searches[0].query, purpose: plan.searches[0].purpose, research: plan.searches[0].research })), engines: ['SearXNG'], diagnostics: [], providerCalls: 1 } as unknown as Awaited<ReturnType<typeof executeSearchRetrieval>>
}

test('validated identities generate bounded specific follow-ups with reasons and evidence URLs', () => {
  publish()
  const seed = result()
  const plan = planAdaptiveResearch('quasar inspection', [seed], new Set(), 2)
  assert.ok(plan.searches.length <= 6)
  for (const reason of ['exact-title-followup', 'solicitation-number-followup', 'buyer-domain-followup', 'attachment-followup', 'portal-followup']) {
    assert.ok(plan.searches.some(search => search.research?.reason === reason), reason)
  }
  assert.ok(plan.searches.every(search => search.research?.wave === 2 && search.research.evidenceUrls.includes(seed.url)))
  assert.ok(plan.searches.some(search => search.query.includes('"26-101"')))
  assert.ok(plan.searches.some(search => search.query.includes('site:city.example.gov')))
})

test('unopened, rejected, stale and arbitrary noun pages cannot supply expansion terms', () => {
  publish()
  const seed = result()
  const junk = result('junk', { title: 'Bananas architecture sightseeing', pageValidation: undefined })
  const stale = result('old', { pageValidation: { ...seed.pageValidation!, lifecycle: { status: 'expired', reason: 'Past due', confidence: 1, dates: [] } } })
  const rejected = result('bad', { bucket: 'rejected' })
  const plan = planAdaptiveResearch('quasar inspection', [junk, stale, rejected], new Set(), 2)
  assert.ok(plan.searches.every(search => ['canonical-service-gap', 'coverage-gap'].includes(search.research!.reason)))
  assert.doesNotMatch(plan.searches.map(search => search.query).join(' '), /Bananas|26-101|junk|old/)
})

test('federal-only evidence drives missing state/local coverage, not raw result count', () => {
  publish()
  const federal = result('FED-1', { url: 'https://sam.gov/opp/record', rfpIntelligence: { ...result().rfpIntelligence!, organization: 'United States Department of Example' } })
  const many = Array.from({ length: 80 }, () => federal)
  const plan = planAdaptiveResearch('quasar inspection', many, new Set(), 2)
  assert.ok(plan.gaps.includes('state-local'))
  assert.ok(plan.searches.some(search => search.research?.gap === 'state-local'))
  assert.ok(!planAdaptiveResearch('federal quasar inspection', [federal], new Set(), 2).gaps.includes('state-local'))
  assert.ok(!planAdaptiveResearch('quasar inspection', [federal, result()], new Set(), 2).gaps.includes('state-local'))
})

test('PDF without a landing page and landing without attachments produce distinct coverage gaps', () => {
  publish()
  const seed = result()
  const pdf = result('PDF-1', { url: 'https://city.example.gov/documents/rfp.pdf', pageValidation: { ...seed.pageValidation!, contentType: 'application/pdf' } })
  assert.ok(planAdaptiveResearch('quasar inspection', [pdf], new Set(), 2).searches.some(search => search.research?.gap === 'official-landing-page'))
  assert.ok(planAdaptiveResearch('quasar inspection', [seed], new Set(), 2).searches.some(search => search.research?.gap === 'attachments'))
})

test('linked portal hosts and document titles come only from validated package evidence', () => {
  publish()
  const seed = result('PORTAL-1', { packageAnalysis: { documents: [{ url: 'https://portal.example.net/opportunities/PORTAL-1', title: 'Quasar inspection addendum details', kind: 'addendum', extracted: true, textLength: 400 }], combinedText: '', discoveredCount: 1, inspectedCount: 1, failedCount: 0, lifecycle: result().pageValidation!.lifecycle } })
  const first = planAdaptiveResearch('quasar inspection', [seed], new Set(), 2)
  const second = planAdaptiveResearch('quasar inspection', [seed], new Set(first.searches.map(search => search.query)), 3)
  const searches = [...first.searches, ...second.searches]
  assert.ok(searches.some(search => search.query.includes('site:portal.example.net') && search.research?.reason === 'portal-followup'))
  assert.ok(searches.some(search => search.query.includes('"Quasar inspection addendum details"')))
})

test('service gap aliases track Neon rows and disappear when the profile is unavailable', () => {
  publish()
  const seed = result('OTHER', { title: 'Other RFP', description: 'Other RFP', content: 'Other RFP', pageValidation: undefined })
  const first = planAdaptiveResearch('quasar inspection', [seed], new Set(), 2)
  assert.ok(first.searches.some(search => search.research?.reason === 'canonical-service-gap' && search.query.includes('"quasar inspection"')))
  setRelevanceProfile(buildProfile(profileRows('violet analysis'), 'neon'))
  assert.ok(!planAdaptiveResearch('quasar inspection', [], new Set(), 2).searches.some(search => search.research?.reason === 'canonical-service-gap'))
  assert.ok(planAdaptiveResearch('violet analysis', [], new Set(), 2).searches.some(search => search.query.includes('"violet analysis"')))
  setRelevanceProfile(null)
  const unavailable = planAdaptiveResearch('quasar inspection', [], new Set(), 2)
  assert.ok(unavailable.searches.length > 0)
  assert.ok(unavailable.searches.every(search => search.research?.reason === 'coverage-gap'))
})

test('normalized executed queries never recur within or across follow-up waves', () => {
  publish()
  const first = planAdaptiveResearch('quasar inspection', [result()], new Set(), 2)
  const seen = new Set(first.searches.map(search => `  ${search.query.toUpperCase().replaceAll(' ', '  ')}  `))
  const next = planAdaptiveResearch('quasar inspection', [result()], seen, 3)
  assert.ok(next.searches.every(search => !new Set([...seen].map(normalizeResearchQuery)).has(normalizeResearchQuery(search.query))))
  assert.equal(new Set(first.searches.map(search => normalizeResearchQuery(search.query))).size, first.searches.length)
  assert.equal(planAdaptiveResearch('quasar inspection', [], new Set(), 4).searches.length, 0)
})

test('bounded provider allocation runs every query and preserves all configured indexes', () => {
  const queries = [1, 2, 3, 4, 5, 6]
  const providers = ['SearXNG', 'Keenable', 'TinyFish', 'Tavily', 'Exa', 'LangSearch'].map(name => ({ name, configured: true, maxVariants: 6 }))
  const allocations = allocateProviderQueries(queries, providers, RESEARCH_LIMITS.providerCallsPerWave - 3)
  assert.equal([...allocations.values()].flat().length, 15)
  assert.deepEqual(allocations.get('SearXNG'), queries)
  assert.ok(providers.every(provider => allocations.get(provider.name)!.length > 0))
  assert.equal([...allocateProviderQueries(queries, providers, Infinity).values()].flat().length, 36)
})

test('tracking variants and junk do not count as novelty; new documents and identities do', () => {
  publish()
  const seed = result()
  const previous = researchSnapshot([seed])
  const duplicate = result('26-101', { url: `${seed.url}?utm_source=another` })
  assert.equal(researchNovelty(previous, researchSnapshot([seed, duplicate])).meaningful, false)
  assert.equal(researchNovelty(previous, researchSnapshot([seed, result('26-102')])).solicitations, 1)
  const attached = result('26-101', { packageAnalysis: { documents: [{ url: 'https://city.example.gov/files/addendum.pdf', kind: 'addendum', extracted: true, textLength: 300 }], combinedText: '', lifecycle: seed.pageValidation!.lifecycle, discoveredCount: 1, inspectedCount: 1, failedCount: 0 } })
  assert.equal(researchNovelty(previous, researchSnapshot([attached])).documents, 1)
  assert.equal(researchNovelty(previous, researchSnapshot([result('junk', { pageValidation: undefined })])).meaningful, false)
})

test('duplicate-heavy follow-up stops at wave two even with hundreds of raw candidates', async () => {
  publish()
  const seed = result()
  let calls = 0
  const final = await continueAdaptiveResearch('quasar inspection', outcome([seed]), { executedQueries: [] }, {
    retrieve: async plan => { calls += 1; return batch(Array.from({ length: 100 }, () => seed), plan) },
    validate: async () => { throw new Error('Repeated URL should not be opened again') },
  })
  assert.equal(calls, 1)
  assert.equal(final.diagnostics.adaptiveResearch.stopReason, 'no-novelty')
  assert.equal(final.diagnostics.adaptiveResearch.wavesCompleted, 2)
  assert.equal(final.results.length, 1)
  assert.ok(final.results[0].retrieval?.research?.length)
})

test('new validated evidence permits wave three but never a fourth; query provenance reaches the trace', async () => {
  publish()
  const traceId = createSearchTrace('quasar inspection')
  const executed: string[] = []
  let calls = 0
  const final = await continueAdaptiveResearch('quasar inspection', outcome([result()]), { traceId, executedQueries: [] }, {
    retrieve: async plan => { executed.push(...plan.searches.map(search => normalizeResearchQuery(search.query))); calls += 1; return batch([result(`NEW-${calls}`)], plan) },
    validate: async (_query, _lens, candidates) => outcome(candidates.map(candidate => result(`NEW-${calls}`, { retrieval: candidate.retrieval }))),
  })
  assert.equal(calls, 2)
  assert.equal(final.diagnostics.adaptiveResearch.wavesCompleted, 3)
  assert.equal(final.diagnostics.adaptiveResearch.stopReason, 'wave-cap')
  assert.equal(new Set(executed).size, executed.length)
  assert.equal(final.results.length, 3)
  const trace = JSON.stringify(getSearchFlightRecord(traceId))
  assert.match(trace, /research.wave-start/)
  assert.match(trace, /exact-title-followup|solicitation-number-followup/)
  assert.ok(final.diagnostics.adaptiveResearch.waves.every(wave => wave.queries.every(search => search.research?.reason)))
})

test('novel raw junk does not authorize a third wave', async () => {
  publish()
  let calls = 0
  const final = await continueAdaptiveResearch('quasar inspection', outcome([result()]), { executedQueries: [] }, {
    retrieve: async plan => { calls += 1; return batch([result('JUNK')], plan) },
    validate: async () => outcome([result('JUNK', { bucket: 'rejected', pageValidation: undefined, validation: { status: 'rejected', relevance: 0, reason: 'Generic page', matchedConcepts: [], mode: 'local-rules' } })], 'rejected'),
  })
  assert.equal(calls, 1)
  assert.equal(final.diagnostics.adaptiveResearch.stopReason, 'no-novelty')
})

test('follow-up failures, cancellation and time/page budgets preserve first-wave results', async () => {
  publish()
  const initial = outcome([result()])
  const failed = await continueAdaptiveResearch('quasar inspection', initial, {}, { retrieve: async () => { throw new Error('Provider outage') } })
  assert.equal(failed.diagnostics.adaptiveResearch.stopReason, 'followup-failed')
  assert.deepEqual(failed.results, initial.results)
  const cancelled = await continueAdaptiveResearch('quasar inspection', initial, { signal: AbortSignal.abort() })
  assert.equal(cancelled.diagnostics.adaptiveResearch.stopReason, 'cancelled')
  const timed = await continueAdaptiveResearch('quasar inspection', initial, { deadline: 10 }, { now: () => 10 })
  assert.equal(timed.diagnostics.adaptiveResearch.stopReason, 'time-budget')
  initial.diagnostics.validationTargets = 60
  assert.equal((await continueAdaptiveResearch('quasar inspection', initial)).diagnostics.adaptiveResearch.stopReason, 'page-budget')
})

test('cross-wave dedupe preserves lifecycle buckets and canonical provider-independent verdicts', () => {
  publish()
  const seed = result()
  const alternative = result('26-101', { url: 'https://portal.example.net/notice/26-101', source: 'TinyFish', score: 100 })
  alternative.retrieval = { sources: ['TinyFish'], queries: ['"26-101"'], purposes: ['portal'], overlap: 1, research: [{ wave: 2, reason: 'portal-followup', evidenceUrls: [seed.url] }] }
  const next = outcome([alternative])
  next.buckets.expired.push(result('OLD', { bucket: 'expired', pageValidation: { ...seed.pageValidation!, lifecycle: { status: 'expired', reason: 'Past due', confidence: 1, dates: [] } } }))
  next.buckets.dead.push(result('DEAD', { bucket: 'dead', pageValidation: { ...seed.pageValidation!, availability: 'dead', lifecycle: { status: 'dead', reason: '404', confidence: 1, dates: [] } } }))
  const merged = mergeResearchOutcomes(outcome([seed]), next)
  assert.equal(merged.results.length, 1)
  assert.equal(merged.buckets.duplicate.length, 1)
  assert.equal(merged.buckets.expired.length, 1)
  assert.equal(merged.buckets.dead.length, 1)
  assert.equal((merged.results[0] as ResearchResult).canonicalDecision!.decision, seed.canonicalDecision!.decision)
  assert.equal((merged.results[0] as ResearchResult).canonicalDecision!.relevance.score, seed.canonicalDecision!.relevance.score)
  assert.ok(merged.results[0].retrieval?.research?.some(item => item.reason === 'portal-followup'))
})

test('Neon unavailable and inaccessible portal results stay REVIEW across merges', () => {
  setRelevanceProfile(null)
  const seed = result()
  const portal = result('PORTAL', { pageValidation: { ...seed.pageValidation!, availability: 'blocked', lifecycle: { status: 'unknown', reason: 'Blocked portal', confidence: 1, dates: [] } } })
  const merged = mergeResearchOutcomes(applyCanonicalDecisionGate(outcome([seed])), applyCanonicalDecisionGate(outcome([portal])))
  assert.equal(merged.buckets.valid.length, 0)
  assert.equal(merged.buckets.uncertain.length, 2)
  assert.ok((merged.results as ResearchResult[]).every(item => item.canonicalDecision?.decision === 'REVIEW'))
})

test('adaptive candidate normalization bounds metadata and preserves query provenance', () => {
  const provenance = { wave: 2, reason: 'exact-title-followup', evidenceUrls: ['https://city.example.gov/notice'], profileVersion: 'profile' }
  const candidates = normalizeBrowserSerpCandidates([{ title: 'Quasar inspection RFP', url: 'https://city.example.gov/notice', query: '"Quasar inspection RFP"', research: provenance }])
  assert.deepEqual(candidates[0].retrieval?.research, [{ ...provenance, gap: undefined }])
  assert.equal(normalizeBrowserSerpCandidates([{ title: 'Bad metadata', url: 'https://example.gov/a', research: { wave: 200, reason: 'arbitrary', content: 'junk' } }])[0].retrieval?.research, undefined)
})

test('real provider retrieval and deep validation run targeted waves with package and lifecycle checks', async () => {
  publish()
  resetSearchSourceHealthForTests()
  process.env.SEARXNG_URL = 'https://search.example.test'
  process.env.DISABLE_LOCAL_SMART_FILTER = 'true'
  for (const key of Object.keys(process.env)) if (/(?:KEENABLE|TINYFISH|TAVILY|EXA|LANGSEARCH).*API_KEY/.test(key)) delete process.env[key]
  const searches: string[] = []
  const opened: string[] = []
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    if (url.hostname === 'search.example.test') {
      searches.push(url.searchParams.get('q') || '')
      return Response.json({ results: [{ title: 'City of Other Quasar inspection RFP', url: 'https://other.example.gov/procurement/NEW-222', content: 'Open request for proposals for quasar inspection. Responses due December 31, 2099.', engine: 'bing' }] })
    }
    if (/google|bing|duckduckgo/.test(url.hostname)) return new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    opened.push(url.toString())
    if (url.pathname.includes('amendment')) return new Response(`<html><head><title>Amendment to RFP NEW-222</title></head><body>${'Amendment to Request for proposals for quasar inspection. '.repeat(20)} Responses due December 31, 2099.</body></html>`, { headers: { 'content-type': 'text/html' } })
    return new Response(`<html><head><title>City of Other Quasar inspection RFP</title></head><body><h1>City of Other Quasar inspection RFP</h1><p>Solicitation number: NEW-222</p><p>City of Other</p>${'Request for proposals for quasar inspection. '.repeat(30)}<p>Responses due December 31, 2099.</p><a href="/amendment.html">RFP Amendment attachment</a></body></html>`, { headers: { 'content-type': 'text/html' } })
  }
  const final = await continueAdaptiveResearch('quasar inspection RFP', outcome([result()]), { executedQueries: [] })
  assert.ok(searches.some(query => query.includes('26-101') || query.includes('City of Example')))
  assert.ok(opened.some(url => url.includes('NEW-222')))
  assert.ok(opened.some(url => url.includes('amendment')))
  assert.ok(final.results.some(item => item.pageValidation?.lifecycle.status === 'open'))
  assert.ok(final.diagnostics.adaptiveResearch.waves.every(wave => wave.providerCalls <= RESEARCH_LIMITS.providerCallsPerWave))
  assert.equal(final.diagnostics.adaptiveResearch.stopReason, 'no-novelty')
  assert.equal(new Set(searches.map(normalizeResearchQuery)).size, searches.length)
  assert.equal(getRelevanceProfile().source, 'neon')
})

test('empty first-wave evidence receives a gap-driven wave instead of stopping on a zero display count', async () => {
  publish()
  let calls = 0
  const final = await continueAdaptiveResearch('quasar inspection', outcome([]), { executedQueries: [] }, {
    retrieve: async plan => {
      calls += 1
      assert.ok(plan.searches.some(search => search.research?.gap === 'validated-procurement-evidence'))
      return batch([], plan)
    },
  })
  assert.equal(calls, 1)
  assert.equal(final.diagnostics.adaptiveResearch.stopReason, 'no-novelty')
})

test('generic rejection and scanned/thin procurement review are unchanged after a cross-wave merge', () => {
  publish()
  const seed = result()
  const url = 'https://buyer.example.gov/procurement/scanned-test.pdf'
  const signals = inspectPageSignals('RFP', url, url, seed.title)
  assert.equal(signals.availability, 'unsupported')
  const scanned = result('SCAN', { url, pageValidation: { ...seed.pageValidation!, finalUrl: url, availability: signals.availability, reason: signals.reason, extractedTextLength: 3, evidence: [], lifecycle: { status: 'unknown', reason: 'Manual review required', confidence: 1, dates: [] } } })
  assert.equal(scanned.canonicalDecision?.decision, 'REVIEW')
  const rejected = result('REJECTED', { validation: { status: 'rejected', relevance: 0, reason: 'Failed generic evidence check', matchedConcepts: [], mode: 'local-rules' } })
  const merged = mergeResearchOutcomes(applyCanonicalDecisionGate(outcome([rejected])), applyCanonicalDecisionGate(outcome([scanned])))
  assert.equal(merged.buckets.rejected.length, 1)
  assert.equal(merged.buckets.uncertain.length, 1)
  assert.equal(merged.buckets.valid.length, 0)
  const followup = planAdaptiveResearch('quasar inspection', merged.results, new Set(), 2)
  assert.ok(followup.searches.some(search => search.research?.reason === 'portal-followup' && search.query.includes('site:buyer.example.gov')))
  assert.equal(researchSnapshot([scanned]).destinations.size, 0)
})
