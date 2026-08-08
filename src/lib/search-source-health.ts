export interface SearchSourceHealthSnapshot {
  source: string
  attempts: number
  successes: number
  failures: number
  consecutiveFailures: number
  averageLatencyMs: number
  lastLatencyMs?: number
  lastSuccessAt?: string
  lastFailureAt?: string
  lastError?: string
  circuitOpen: boolean
  circuitOpenUntil?: string
}

interface SearchSourceHealthState {
  attempts: number
  successes: number
  failures: number
  consecutiveFailures: number
  averageLatencyMs: number
  lastLatencyMs?: number
  lastSuccessAt?: number
  lastFailureAt?: number
  lastError?: string
  circuitOpenUntil?: number
}

const FAILURE_THRESHOLD = 3
const BASE_OPEN_MS = 45_000
const MAX_OPEN_MS = 5 * 60_000
const EWMA_ALPHA = 0.25
const GLOBAL_KEY = '__ULTRA_SEARCH_SOURCE_HEALTH_V1__'

type GlobalWithHealth = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, SearchSourceHealthState>
}

function store(): Map<string, SearchSourceHealthState> {
  const globalObject = globalThis as GlobalWithHealth
  if (!globalObject[GLOBAL_KEY]) globalObject[GLOBAL_KEY] = new Map()
  return globalObject[GLOBAL_KEY]!
}

function stateFor(source: string): SearchSourceHealthState {
  const key = source.trim() || 'unknown'
  const health = store()
  let state = health.get(key)
  if (!state) {
    state = {
      attempts: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      averageLatencyMs: 0,
    }
    health.set(key, state)
  }
  return state
}

function updateLatency(state: SearchSourceHealthState, latencyMs: number) {
  const bounded = Math.max(0, Math.min(120_000, Math.round(latencyMs)))
  state.lastLatencyMs = bounded
  state.averageLatencyMs = state.averageLatencyMs === 0
    ? bounded
    : Math.round(state.averageLatencyMs * (1 - EWMA_ALPHA) + bounded * EWMA_ALPHA)
}

export function canAttemptSearchSource(source: string, now = Date.now()): boolean {
  const state = stateFor(source)
  if (!state.circuitOpenUntil) return true
  if (state.circuitOpenUntil <= now) {
    state.circuitOpenUntil = undefined
    // Half-open: permit one new attempt while retaining the failure history.
    return true
  }
  return false
}

export function recordSearchSourceSuccess(source: string, latencyMs: number, now = Date.now()): void {
  const state = stateFor(source)
  state.attempts += 1
  state.successes += 1
  state.consecutiveFailures = 0
  state.lastSuccessAt = now
  state.lastError = undefined
  state.circuitOpenUntil = undefined
  updateLatency(state, latencyMs)
}

export function recordSearchSourceFailure(source: string, latencyMs: number, error: string, now = Date.now()): void {
  const state = stateFor(source)
  state.attempts += 1
  state.failures += 1
  state.consecutiveFailures += 1
  state.lastFailureAt = now
  state.lastError = error.slice(0, 500)
  updateLatency(state, latencyMs)

  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    const exponent = Math.min(3, state.consecutiveFailures - FAILURE_THRESHOLD)
    state.circuitOpenUntil = now + Math.min(MAX_OPEN_MS, BASE_OPEN_MS * (2 ** exponent))
  }
}

export function searchSourceHealthSnapshot(now = Date.now()): SearchSourceHealthSnapshot[] {
  return Array.from(store().entries()).map(([source, state]) => ({
    source,
    attempts: state.attempts,
    successes: state.successes,
    failures: state.failures,
    consecutiveFailures: state.consecutiveFailures,
    averageLatencyMs: state.averageLatencyMs,
    lastLatencyMs: state.lastLatencyMs,
    lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : undefined,
    lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : undefined,
    lastError: state.lastError,
    circuitOpen: Boolean(state.circuitOpenUntil && state.circuitOpenUntil > now),
    circuitOpenUntil: state.circuitOpenUntil ? new Date(state.circuitOpenUntil).toISOString() : undefined,
  })).sort((left, right) => left.source.localeCompare(right.source))
}

/** Test-only reset; intentionally not exposed through an HTTP route. */
export function resetSearchSourceHealthForTests(): void {
  store().clear()
}
