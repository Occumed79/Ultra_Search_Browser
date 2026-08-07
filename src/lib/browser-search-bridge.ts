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
  transport: 'browser-extension'
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

const APP_SOURCE = 'ultra-search-app'
const EXTENSION_SOURCE = 'ultra-search-extension'

function requestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `usb-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isExtensionMessage(event: MessageEvent): boolean {
  return event.source === window
    && Boolean(event.data)
    && event.data.source === EXTENSION_SOURCE
}

export async function browserCompanionAvailable(timeoutMs = 750): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const id = requestId()

  return new Promise(resolve => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(value)
    }
    const onMessage = (event: MessageEvent) => {
      if (!isExtensionMessage(event)) return
      if (event.data.type === 'ULTRA_SEARCH_PONG' && event.data.requestId === id) finish(true)
    }
    const timer = window.setTimeout(() => finish(false), timeoutMs)
    window.addEventListener('message', onMessage)
    window.postMessage({ source: APP_SOURCE, type: 'ULTRA_SEARCH_PING', requestId: id }, window.location.origin)
  })
}

export async function runBrowserSearchPlan(
  plan: BrowserBridgePlan,
  timeoutMs = 120_000
): Promise<BrowserBridgeResult> {
  if (typeof window === 'undefined') throw new Error('Browser search is only available in the browser.')
  const id = requestId()

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      callback()
    }
    const onMessage = (event: MessageEvent) => {
      if (!isExtensionMessage(event) || event.data.requestId !== id) return
      if (event.data.type === 'ULTRA_SEARCH_RESULTS') {
        finish(() => resolve({
          results: Array.isArray(event.data.results) ? event.data.results : [],
          engines: Array.isArray(event.data.engines) ? event.data.engines : [],
          attemptedSearches: Number(event.data.attemptedSearches || 0),
          successfulSearches: Number(event.data.successfulSearches || 0),
          diagnostics: Array.isArray(event.data.diagnostics) ? event.data.diagnostics : [],
        }))
      } else if (event.data.type === 'ULTRA_SEARCH_ERROR') {
        finish(() => reject(new Error(event.data.error || 'Browser companion search failed.')))
      }
    }
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('Browser companion did not finish the search plan.')))
    }, timeoutMs)

    window.addEventListener('message', onMessage)
    window.postMessage({
      source: APP_SOURCE,
      type: 'ULTRA_SEARCH_RUN',
      requestId: id,
      plan,
    }, window.location.origin)
  })
}
