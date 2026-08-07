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
}

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

export type BrowserBridgeTransport = 'searxng' | 'zero-key-direct-rescue' | 'searxng+direct-rescue'

export interface BrowserBridgeResult {
  results: BrowserBridgeCandidate[]
  engines: string[]
  attemptedSearches: number
  successfulSearches: number
  transport?: BrowserBridgeTransport
  diagnostics?: Array<{
    query?: string
    engine?: string
    resultCount?: number
    error?: string
  }>
}

/**
 * Historical export name retained to avoid a large caller churn. There is no
 * browser companion anymore; a normal browser session is sufficient because
 * retrieval now happens through the app's own server endpoint.
 */
export async function browserCompanionAvailable(): Promise<boolean> {
  return typeof window !== 'undefined'
}

/** Execute the deterministic Occu-Med search plan through the app server. */
export async function runBrowserSearchPlan(
  plan: BrowserBridgePlan,
  timeoutMs = 70_000
): Promise<BrowserBridgeResult> {
  if (typeof window === 'undefined') throw new Error('Ultra Search retrieval is only available from the app.')

  let response: Response
  try {
    response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`Search retrieval timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    }
    throw error
  }

  const payload = await response.json().catch(() => null) as (BrowserBridgeResult & {
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
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
  }
}
