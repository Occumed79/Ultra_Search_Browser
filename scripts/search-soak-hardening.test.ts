import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { buildBrowserSearchPlan } from '../src/lib/browser-search-pipeline'
import { processSearchCandidates } from '../src/lib/search-candidate-processing'
import {
  createSearchTrace,
  finishSearchTrace,
  recentSearchFlightRecords,
  resetSearchFlightRecorderForTests,
  searchFlightRecorderStats,
} from '../src/lib/search-flight-recorder'

function candidates(query: string, round: number, count = 60) {
  return Array.from({ length: count }, (_, index) => ({
    title: index % 3 === 0
      ? `RFP ${round}-${index} Occupational Health and Medical Surveillance Services`
      : index % 3 === 1
        ? `Solicitation ${round}-${index} Employee Medical Examinations and Audiometry`
        : `Request for Proposals ${round}-${index} Respirator Medical Clearance and Drug Testing`,
    url: `https://buyer-${round % 7}.example.gov/procurement/rfp-${round}-${index}.pdf?utm_source=soak`,
    description: 'Public procurement for occupational health services, employee medical examinations, medical surveillance, audiometric testing, spirometry, respirator medical clearance, drug testing, and provider network coordination. Proposals are due October 30, 2026.',
    source: index % 2 ? 'SearXNG · bing' : 'SearXNG · brave',
    rank: index + 1,
    score: Math.max(10, 100 - index),
    query: `${query} solicitation`,
    purpose: index % 2 ? 'official-procurement' : 'document-procurement',
  }))
}

async function oneRound(round: number) {
  const query = round % 2 ? 'occupational health services' : 'employee medical examinations'
  const plan = buildBrowserSearchPlan(query, 8)
  return processSearchCandidates({
    query,
    intent: plan.intent,
    searches: plan.searches,
    results: candidates(query, round),
    transport: 'searxng',
    retrievalMode: 'soak-fixture',
    productMode: 'rfp-finder-searxng',
    persist: false,
  })
}

test('repeated 60-candidate searches remain bounded and deterministic under soak', async () => {
  const heapBefore = process.memoryUsage().heapUsed
  const runtimes: number[] = []
  let totalRetained = 0

  for (let round = 0; round < 36; round += 1) {
    const startedAt = performance.now()
    const output = await oneRound(round)
    runtimes.push(performance.now() - startedAt)
    totalRetained += output.results.length
    assert.equal(output.diagnostics.persistenceAttempted, false)
    assert.ok(output.results.length <= 40, `candidate result cap expanded unexpectedly to ${output.results.length}`)
    assert.equal(output.diagnostics.transport, 'searxng')
  }

  const heapAfter = process.memoryUsage().heapUsed
  const heapGrowthMb = Math.max(0, heapAfter - heapBefore) / (1024 * 1024)
  const sorted = [...runtimes].sort((a, b) => a - b)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]

  assert.ok(totalRetained > 0, 'soak corpus unexpectedly retained no valid procurement candidates')
  // This is deliberately generous enough for CI variance while still catching
  // retained per-search candidate payloads or accidental unbounded caches.
  assert.ok(heapGrowthMb < 128, `heap grew by ${heapGrowthMb.toFixed(1)} MB across 36 searches`)
  assert.ok(p95 < 5_000, `candidate-processing p95 grew to ${Math.round(p95)}ms`)
})

test('parallel candidate processing does not cross-contaminate query ownership', async () => {
  const outputs = await Promise.all(Array.from({ length: 12 }, (_, index) => oneRound(100 + index)))
  assert.equal(outputs.length, 12)
  for (const [index, output] of outputs.entries()) {
    const expected = (100 + index) % 2 ? 'occupational health services' : 'employee medical examinations'
    assert.equal(output.query, expected)
    assert.equal(output.lens, 'procurement')
    assert.equal(output.diagnostics.persistenceAttempted, false)
  }
})

test('flight recorder stays bounded after more traces than its retention ceiling', () => {
  resetSearchFlightRecorderForTests()
  for (let index = 0; index < 180; index += 1) {
    const traceId = createSearchTrace(`soak query ${index}`)
    finishSearchTrace(traceId, 'complete', { index })
  }
  const stats = searchFlightRecorderStats()
  assert.ok(stats.retainedTraces <= stats.maxTraces)
  assert.ok(recentSearchFlightRecords(200).length <= stats.maxTraces)
})
