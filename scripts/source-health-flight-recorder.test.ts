import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  canAttemptSearchSource,
  recordSearchSourceFailure,
  recordSearchSourceSuccess,
  resetSearchSourceHealthForTests,
  searchSourceHealthSnapshot,
} from '../src/lib/search-source-health'
import {
  createSearchTrace,
  finishSearchTrace,
  getSearchFlightRecord,
  recordSearchFlightStage,
  resetSearchFlightRecorderForTests,
} from '../src/lib/search-flight-recorder'

test('source circuit breaker opens after repeated transport failures and permits half-open retry later', () => {
  resetSearchSourceHealthForTests()
  const now = 1_800_000_000_000
  assert.equal(canAttemptSearchSource('SearXNG', now), true)
  recordSearchSourceFailure('SearXNG', 1000, 'timeout one', now)
  recordSearchSourceFailure('SearXNG', 1200, 'timeout two', now + 100)
  recordSearchSourceFailure('SearXNG', 1500, 'timeout three', now + 200)
  assert.equal(canAttemptSearchSource('SearXNG', now + 1_000), false)

  const snapshot = searchSourceHealthSnapshot(now + 1_000).find(item => item.source === 'SearXNG')
  assert.equal(snapshot?.circuitOpen, true)
  assert.equal(snapshot?.consecutiveFailures, 3)
  assert.ok((snapshot?.averageLatencyMs || 0) > 0)

  assert.equal(canAttemptSearchSource('SearXNG', now + 50_000), true)
  recordSearchSourceSuccess('SearXNG', 400, now + 50_100)
  const recovered = searchSourceHealthSnapshot(now + 50_200).find(item => item.source === 'SearXNG')
  assert.equal(recovered?.circuitOpen, false)
  assert.equal(recovered?.consecutiveFailures, 0)
  assert.equal(recovered?.successes, 1)
})

test('flight recorder preserves stage counts while stripping secret-shaped fields', () => {
  resetSearchFlightRecorderForTests()
  const traceId = createSearchTrace('occupational health services')
  recordSearchFlightStage(traceId, 'retrieval.complete', {
    raw: 50,
    authorization: 'Bearer should-never-survive',
    apiKey: 'secret-key-value',
    nested: { token: 'secret-token', transport: 'searxng' },
  })
  finishSearchTrace(traceId, 'complete', { verifiedCount: 2 })

  const trace = getSearchFlightRecord(traceId)
  assert.equal(trace?.status, 'complete')
  assert.equal(trace?.query, 'occupational health services')
  assert.ok((trace?.stages.length || 0) >= 2)
  const serialized = JSON.stringify(trace)
  assert.doesNotMatch(serialized, /should-never-survive|secret-key-value|secret-token/)
  assert.match(serialized, /searxng/)
})

test('planner, retrieval, ingest, validation, and diagnostics share the trace contract', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const plan = readFileSync(`${root}/src/app/api/search/plan/route.ts`, 'utf8')
  const retrieval = readFileSync(`${root}/src/app/api/search/route.ts`, 'utf8')
  const ingest = readFileSync(`${root}/src/app/api/search/ingest/route.ts`, 'utf8')
  const validation = readFileSync(`${root}/src/app/api/search/validate/route.ts`, 'utf8')
  const diagnostics = readFileSync(`${root}/src/app/api/diagnostics/search-traces/route.ts`, 'utf8')

  assert.match(plan, /__traceId/)
  assert.match(retrieval, /retrieval\.complete/)
  assert.match(ingest, /ingest\.complete/)
  assert.match(validation, /validation\.decision-gate/)
  assert.match(validation, /finishSearchTrace\(traceId, 'complete'/)
  assert.match(diagnostics, /recentSearchFlightRecords/)
  assert.match(diagnostics, /searchSourceHealthSnapshot/)
})
