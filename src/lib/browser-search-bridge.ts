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

export interface BrowserBridgeResult {
  results: BrowserBridgeCandidate[]
  engines: string[]
  attemptedSearches: number
  successfulSearches: number
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

/**
 * Execute the deterministic Occu-Med search plan on the server. SearXNG is the
 * preferred zero-key metasearch transport; bounded direct-engine rescue is
 * handled server-side when the private SearXNG service is unavailable or sparse.
 */
export async function runBrowserSearchPlan(
  plan: BrowserBridgePlan,
  timeoutMs = 120_000
): Promise<BrowserBridgeResult> {
  if (typeof window === 'undefined') throw new Error('Ultra Search retrieval is only available from the app.')

  const response = await fetch('/api/search', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plan }),
    signal: AbortSignal.timeout(timeoutMs),
  })

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
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
  }
}
