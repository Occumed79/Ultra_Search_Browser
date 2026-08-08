import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSearchTrace,
  finishSearchTrace,
  getSearchFlightRecord,
  recordSearchFlightStage,
  resetSearchFlightRecorderForTests,
} from '../src/lib/search-flight-recorder'
import {
  canAttemptSearchSource,
  recordSearchSourceFailure,
  resetSearchSourceHealthForTests,
} from '../src/lib/search-source-health'

test('flight recorder and circuit breaker stay bounded at merge gate', () => {
  resetSearchFlightRecorderForTests()
  const traceId = createSearchTrace('occupational health services')
  recordSearchFlightStage(traceId, 'merge-gate', { raw: 50, authorization: 'must-not-survive' })
  finishSearchTrace(traceId, 'complete', { verified: 1 })
  const trace = getSearchFlightRecord(traceId)
  assert.equal(trace?.status, 'complete')
  assert.doesNotMatch(JSON.stringify(trace), /must-not-survive/)

  resetSearchSourceHealthForTests()
  const now = 1_800_000_000_000
  recordSearchSourceFailure('SearXNG', 100, 'one', now)
  recordSearchSourceFailure('SearXNG', 100, 'two', now + 1)
  recordSearchSourceFailure('SearXNG', 100, 'three', now + 2)
  assert.equal(canAttemptSearchSource('SearXNG', now + 10), false)
})
