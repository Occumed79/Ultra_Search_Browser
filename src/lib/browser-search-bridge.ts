'use client'

import type { SemanticIntentPlan } from './semantic-intent'

export interface BrowserBridgeSearchVariant {
  id: string
  query: string
  purpose: string
  priority: number
}

export interface BrowserBridgePlan {
  query: string
  lens: 'procurement'
  intent: SemanticIntentPlan
  searches: BrowserBridgeSearchVariant[]
  transport: 'searxng'
  apiKeysRequired: false
  maxResultsPerSearch: number
  timestamp: string
  traceId?: string
}

export type ServerSearchPlan = BrowserBridgePlan

export interface BrowserBridgeCandidate {
  title: string
  url: string
  description?: string
  source?: string
  rank?: number
  score?: number
  query?: string
  purpose?: string
}

export type BrowserBridgeTransport =
  | 'searxng'
  | 'keenable'
  | 'multi-source'
  | 'zero-key-direct-rescue'
  | 'searxng+direct-rescue'
  | 'searxng+keenable'
  | 'keenable+direct-rescue'
  | 'searxng+keenable+direct-rescue'
  | 'multi-source+direct-rescue'
export type ServerSearchTransport = BrowserBridgeTransport

export interface BrowserBridgeResult {
  results: BrowserBridgeCandidate[]
  engines: string[]
  attemptedSearches: number
  successfulSearches: number
  transport?: BrowserBridgeTransport
  traceId?: string
  sourceHealth?: Array<{
    source: string
    attempts: number
    successes: number
    failures: number
    consecutiveFailures: number
    averageLatencyMs: number
    circuitOpen: boolean
    circuitOpenUntil?: string
    lastError?: string
  }>
  diagnostics?: Array<{
    query?: string
    engine?: string
    resultCount?: number
    latencyMs?: number
    circuitOpen?: boolean
    error?: string
  }>
}

export type ServerSearchResult = BrowserBridgeResult

interface ServerSearchOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

function createRequestSignal(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(new DOMException('Search retrieval timed out', 'TimeoutError')), timeoutMs)
  const abortFromExternal = () => controller.abort(externalSignal?.reason)

  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal()
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true })
  }

  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', abortFromExternal)
    },
  }
}

/** Execute the deterministic Occu-Med plan through the app's server retrieval endpoint. */
export async function runServerSearchPlan(
  plan: ServerSearchPlan,
  options: ServerSearchOptions = {}
): Promise<ServerSearchResult> {
  if (typeof window === 'undefined') throw new Error('Ultra Search retrieval is only available from the app.')

  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs ?? 70_000, 90_000))
  const requestSignal = createRequestSignal(timeoutMs, options.signal)

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan }),
      signal: requestSignal.signal,
    })

    const payload = await response.json().catch(() => null) as (ServerSearchResult & {
      error?: string
      detail?: string
    }) | null

    if (!response.ok || !payload) {
      throw new Error(payload?.detail || payload?.error || `Search retrieval failed (HTTP ${response.status}).`)
    }

    return {
      results: Array.isArray(payload.results) ? payload.results : [],
      engines: Array.isArray(payload.engines) ? payload.engines : [],
      attemptedSearches: Number(payload.attemptedSearches || 0),
      successfulSearches: Number(payload.successfulSearches || 0),
      transport: payload.transport,
      traceId: payload.traceId || plan.traceId,
      sourceHealth: Array.isArray(payload.sourceHealth) ? payload.sourceHealth : [],
      diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
    }
  } catch (error) {
    if (requestSignal.signal.aborted) {
      if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
      throw new Error(`Search retrieval timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    }
    throw error
  } finally {
    requestSignal.cleanup()
  }
}

/** @deprecated The app no longer requires a browser companion. */
export async function browserCompanionAvailable(): Promise<boolean> {
  return typeof window !== 'undefined'
}

/** @deprecated Use runServerSearchPlan. Kept for compatibility with older callers. */
export async function runBrowserSearchPlan(
  plan: BrowserBridgePlan,
  timeoutMs = 70_000
): Promise<BrowserBridgeResult> {
  return runServerSearchPlan(plan, { timeoutMs })
}
