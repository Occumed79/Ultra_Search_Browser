import { randomUUID } from 'node:crypto'

export interface SearchFlightStage {
  stage: string
  at: string
  elapsedMs: number
  details: Record<string, unknown>
}

export interface SearchFlightRecord {
  traceId: string
  query: string
  startedAt: string
  updatedAt: string
  status: 'running' | 'complete' | 'error'
  totalRuntimeMs?: number
  stages: SearchFlightStage[]
}

interface InternalRecord extends SearchFlightRecord {
  startedAtMs: number
  updatedAtMs: number
}

const GLOBAL_KEY = '__ULTRA_SEARCH_FLIGHT_RECORDER_V1__'
const MAX_TRACES = 100
const MAX_STAGES_PER_TRACE = 80
const TRACE_TTL_MS = 60 * 60_000
const MAX_STRING = 700

type GlobalWithRecorder = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, InternalRecord>
}

function store(): Map<string, InternalRecord> {
  const globalObject = globalThis as GlobalWithRecorder
  if (!globalObject[GLOBAL_KEY]) globalObject[GLOBAL_KEY] = new Map()
  return globalObject[GLOBAL_KEY]!
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth-limit]'
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, MAX_STRING)
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 40)
      .filter(([key]) => !/(?:key|token|authorization|cookie|password|secret|extractedtext|content)$/i.test(key))
      .map(([key, child]) => [key, sanitize(child, depth + 1)]))
  }
  return String(value).slice(0, MAX_STRING)
}

function prune(now = Date.now()) {
  const traces = store()
  for (const [id, record] of traces) {
    if (now - record.updatedAtMs > TRACE_TTL_MS) traces.delete(id)
  }
  if (traces.size <= MAX_TRACES) return
  const oldest = Array.from(traces.values()).sort((a, b) => a.updatedAtMs - b.updatedAtMs)
  for (const record of oldest.slice(0, traces.size - MAX_TRACES)) traces.delete(record.traceId)
}

function publicRecord(record: InternalRecord): SearchFlightRecord {
  const { startedAtMs: _startedAtMs, updatedAtMs: _updatedAtMs, ...visible } = record
  return structuredClone(visible)
}

export function createSearchTrace(query: string, requestedTraceId?: string): string {
  prune()
  const traceId = requestedTraceId?.trim().slice(0, 100) || randomUUID()
  const traces = store()
  if (traces.has(traceId)) return traceId
  const now = Date.now()
  const cleanQuery = query.replace(/\s+/g, ' ').trim().slice(0, 600)
  traces.set(traceId, {
    traceId,
    query: cleanQuery,
    startedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    startedAtMs: now,
    updatedAtMs: now,
    status: 'running',
    stages: [],
  })
  return traceId
}

export function recordSearchFlightStage(
  traceId: string | undefined,
  stage: string,
  details: Record<string, unknown> = {}
): void {
  if (!traceId) return
  const traces = store()
  const record = traces.get(traceId)
  if (!record) return
  const now = Date.now()
  record.updatedAt = new Date(now).toISOString()
  record.updatedAtMs = now
  record.stages.push({
    stage: stage.slice(0, 100),
    at: record.updatedAt,
    elapsedMs: now - record.startedAtMs,
    details: sanitize(details) as Record<string, unknown>,
  })
  if (record.stages.length > MAX_STAGES_PER_TRACE) record.stages.splice(0, record.stages.length - MAX_STAGES_PER_TRACE)
}

export function finishSearchTrace(
  traceId: string | undefined,
  status: 'complete' | 'error',
  details: Record<string, unknown> = {}
): void {
  if (!traceId) return
  recordSearchFlightStage(traceId, status === 'complete' ? 'trace.complete' : 'trace.error', details)
  const record = store().get(traceId)
  if (!record) return
  record.status = status
  record.totalRuntimeMs = Date.now() - record.startedAtMs
  record.updatedAtMs = Date.now()
  record.updatedAt = new Date(record.updatedAtMs).toISOString()
}

export function getSearchFlightRecord(traceId: string): SearchFlightRecord | undefined {
  prune()
  const record = store().get(traceId)
  return record ? publicRecord(record) : undefined
}

export function recentSearchFlightRecords(limit = 20): SearchFlightRecord[] {
  prune()
  return Array.from(store().values())
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map(publicRecord)
}

export function searchFlightRecorderStats() {
  prune()
  const records = Array.from(store().values())
  return {
    retainedTraces: records.length,
    running: records.filter(record => record.status === 'running').length,
    complete: records.filter(record => record.status === 'complete').length,
    error: records.filter(record => record.status === 'error').length,
    maxTraces: MAX_TRACES,
    ttlMs: TRACE_TTL_MS,
  }
}

/** Test-only reset; intentionally not exposed through an HTTP route. */
export function resetSearchFlightRecorderForTests(): void {
  store().clear()
}
