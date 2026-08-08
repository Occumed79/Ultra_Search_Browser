'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type IntelligenceObject,
  type ScrapedResult,
  type SearchLens,
  type SearchResultBuckets,
  type SearchSuggestion,
  type SearchValidationProgress,
  type UserSettings,
} from '@/types/search'
import { useLocalStorage } from './use-local-storage'
import { DEFAULT_USER_SETTINGS, normalizeUserSettings, toSearchRequestPreferences } from '@/lib/search-settings'
import type { SemanticIntentPlan } from '@/lib/semantic-intent'
import { buildSearchPath, parseSearchUrl } from '@/lib/search-url'
import {
  runServerSearchPlan,
  type ServerSearchPlan,
  type ServerSearchTransport,
} from '@/lib/browser-search-bridge'

interface RetrievalStatus {
  transport: ServerSearchTransport | 'unknown'
  attemptedSearches: number
  successfulSearches: number
  engines: string[]
  diagnostics: Array<{
    query?: string
    engine?: string
    resultCount?: number
    error?: string
  }>
}

interface UseSearchReturn {
  query: string
  setQuery: (q: string) => void
  lens: SearchLens
  setLens: (l: SearchLens) => void
  intelligence: IntelligenceObject | null
  scrapedResults: ScrapedResult[]
  resultBuckets: SearchResultBuckets
  validationProgress: SearchValidationProgress | null
  retrievalStatus: RetrievalStatus | null
  isLoading: boolean
  isEnriching: boolean
  enrichmentError: string | null
  error: string | null
  suggestions: SearchSuggestion[]
  hasSearched: boolean
  searchTime: number
  performSearch: () => Promise<void>
  settings: UserSettings
}

type HistoryMode = 'push' | 'replace' | 'none'

interface SearchPayload {
  error?: string
  detail?: string
  query?: string
  lens?: SearchLens
  requestedLens?: SearchLens
  summary?: string
  expandedQueries?: string[]
  signals?: Array<{ name: string; score: number; description: string }>
  results?: ScrapedResult[]
  sources?: string[]
  timestamp?: string
  confidence?: number
  searchRunId?: string | null
  intent?: SemanticIntentPlan
}

const EMPTY_BUCKETS: SearchResultBuckets = {
  valid: [],
  uncertain: [],
  expired: [],
  dead: [],
  rejected: [],
  duplicate: [],
}

const PLAN_TIMEOUT_MS = 15_000
const INGEST_TIMEOUT_MS = 30_000
const ENRICH_TIMEOUT_MS = 25_000
const VALIDATION_TIMEOUT_MS = 118_000
const MAX_VALIDATION_TARGETS = 48

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  if (!block.trim()) return null
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

function searchSuggestions(queries: string[]): SearchSuggestion[] {
  return queries.map((text, index) => ({
    text,
    type: index === 0 ? ('related' as const) : ('ai' as const),
    score: Math.max(0.1, 1 - index * 0.1),
  }))
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Request timed out', 'TimeoutError'))
  }, timeoutMs)
  const abortFromExternal = () => controller.abort(externalSignal?.reason)

  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal()
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true })
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    throw error
  } finally {
    window.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}

export function useSearch(): UseSearchReturn {
  const [storedSettings] = useLocalStorage<UserSettings>('user-settings', DEFAULT_USER_SETTINGS)
  const settings = useMemo(() => normalizeUserSettings(storedSettings), [storedSettings])
  const [query, setQuery] = useState('')
  const [lens, setLens] = useState<SearchLens>('procurement')
  const [intelligence, setIntelligence] = useState<IntelligenceObject | null>(null)
  const [scrapedResults, setScrapedResults] = useState<ScrapedResult[]>([])
  const [resultBuckets, setResultBuckets] = useState<SearchResultBuckets>(EMPTY_BUCKETS)
  const [validationProgress, setValidationProgress] = useState<SearchValidationProgress | null>(null)
  const [retrievalStatus, setRetrievalStatus] = useState<RetrievalStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isEnriching, setIsEnriching] = useState(false)
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [searchTime, setSearchTime] = useState(0)
  const searchSequence = useRef(0)
  const searchController = useRef<AbortController | null>(null)
  const validationController = useRef<AbortController | null>(null)
  const initializedFromUrl = useRef(false)

  const abortActiveWork = useCallback(() => {
    searchController.current?.abort(new DOMException('Superseded by a newer search', 'AbortError'))
    validationController.current?.abort(new DOMException('Superseded by a newer search', 'AbortError'))
    searchController.current = null
    validationController.current = null
  }, [])

  const resetSearch = useCallback(() => {
    searchSequence.current += 1
    abortActiveWork()
    setQuery('')
    setLens('procurement')
    setIntelligence(null)
    setScrapedResults([])
    setResultBuckets(EMPTY_BUCKETS)
    setValidationProgress(null)
    setRetrievalStatus(null)
    setIsLoading(false)
    setIsEnriching(false)
    setEnrichmentError(null)
    setError(null)
    setSuggestions([])
    setHasSearched(false)
    setSearchTime(0)
  }, [abortActiveWork])

  const runFallbackEnrichment = useCallback(async (
    searchQuery: string,
    searchLens: SearchLens,
    results: ScrapedResult[],
    sequence: number,
    semanticIntent?: SemanticIntentPlan,
    signal?: AbortSignal
  ) => {
    const response = await fetchWithTimeout('/api/search/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, lens: searchLens, results, intent: semanticIntent }),
    }, ENRICH_TIMEOUT_MS, signal)
    const enrichment = await response.json().catch(() => null) as {
      results?: ScrapedResult[]
      error?: string
      detail?: string
    } | null
    if (!response.ok) throw new Error(enrichment?.detail || enrichment?.error || 'Enrichment failed')
    if (searchSequence.current === sequence && enrichment?.results) {
      const uncertain = enrichment.results.map(result => ({
        ...result,
        bucket: 'uncertain' as const,
        validation: {
          status: 'uncertain' as const,
          relevance: result.validation?.relevance || 0,
          reason: result.validation?.reason || 'Page-level verification did not complete.',
          matchedConcepts: result.validation?.matchedConcepts || [],
          mode: result.validation?.mode || 'local-rules' as const,
        },
      }))
      setScrapedResults(uncertain)
      setResultBuckets({ ...EMPTY_BUCKETS, uncertain })
    }
  }, [])

  const runStreamingValidation = useCallback(async (
    searchQuery: string,
    searchLens: SearchLens,
    results: ScrapedResult[],
    sequence: number,
    semanticIntent?: SemanticIntentPlan
  ) => {
    validationController.current?.abort()
    const controller = new AbortController()
    validationController.current = controller
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('Complete-package validation timed out', 'TimeoutError'))
    }, VALIDATION_TIMEOUT_MS)

    setIsEnriching(true)
    setEnrichmentError(null)
    setValidationProgress({
      phase: 'opening-pages',
      total: Math.min(MAX_VALIDATION_TARGETS, results.length),
      checked: 0,
      reachable: 0,
      valid: 0,
      uncertain: 0,
      expired: 0,
      dead: 0,
      rejected: 0,
      duplicates: 0,
    })

    const handleEvent = (block: string) => {
      if (searchSequence.current !== sequence) return
      const parsed = parseSseBlock(block)
      if (!parsed) return

      if (parsed.event === 'progress') {
        const payload = parsed.data as { progress?: SearchValidationProgress }
        if (payload.progress) setValidationProgress(payload.progress)
        return
      }

      if (parsed.event === 'result') {
        const payload = parsed.data as {
          progress?: SearchValidationProgress
          result?: ScrapedResult
        }
        if (payload.progress) setValidationProgress(payload.progress)
        if (payload.result) {
          const validatedResult = payload.result
          setScrapedResults(current => current.map(result => {
            const requestedUrl = validatedResult.pageValidation?.requestedUrl
            return result.url === requestedUrl || result.url === validatedResult.url
              ? { ...validatedResult, bucket: 'uncertain' }
              : result
          }))
        }
        return
      }

      if (parsed.event === 'complete') {
        const payload = parsed.data as {
          results?: ScrapedResult[]
          buckets?: SearchResultBuckets
          progress?: SearchValidationProgress
          summary?: string
          confidence?: number
          lens?: SearchLens
        }
        if (payload.results) setScrapedResults(payload.results)
        if (payload.buckets) setResultBuckets(payload.buckets)
        if (payload.progress) setValidationProgress(payload.progress)
        setIntelligence(current => current ? {
          ...current,
          lens: payload.lens || current.lens,
          summary: payload.summary,
          confidence: payload.confidence ?? 0,
        } : current)
        return
      }

      if (parsed.event === 'error') {
        const payload = parsed.data as { detail?: string; error?: string }
        throw new Error(payload.detail || payload.error || 'Deep validation failed')
      }
    }

    try {
      const response = await fetch('/api/search/validate', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: searchQuery, lens: searchLens, results, intent: semanticIntent }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`Validation stream unavailable (HTTP ${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let completed = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          const parsed = parseSseBlock(block)
          if (parsed?.event === 'complete') completed = true
          handleEvent(block)
        }
      }

      if (buffer.trim()) {
        const parsed = parseSseBlock(buffer)
        if (parsed?.event === 'complete') completed = true
        handleEvent(buffer)
      }

      if (!completed) throw new Error('Validation stream ended before completion')
    } catch (validationFailure) {
      if (searchSequence.current !== sequence) return
      if (controller.signal.aborted && !timedOut) return

      const fallbackController = new AbortController()
      if (validationController.current === controller) validationController.current = fallbackController
      try {
        await runFallbackEnrichment(searchQuery, searchLens, results, sequence, semanticIntent, fallbackController.signal)
      } catch (fallbackFailure) {
        if (fallbackController.signal.aborted || searchSequence.current !== sequence) return
        const primary = timedOut
          ? `Complete-package validation timed out after ${Math.round(VALIDATION_TIMEOUT_MS / 1000)} seconds`
          : validationFailure instanceof Error ? validationFailure.message : 'Validation failed'
        const fallback = fallbackFailure instanceof Error ? fallbackFailure.message : 'Fallback enrichment failed'
        setEnrichmentError(`${primary}. ${fallback}`)
      } finally {
        if (validationController.current === fallbackController) validationController.current = null
      }
    } finally {
      window.clearTimeout(timeout)
      if (validationController.current === controller) validationController.current = null
      if (searchSequence.current === sequence) setIsEnriching(false)
    }
  }, [runFallbackEnrichment])

  const executeSearch = useCallback(async (
    searchQuery: string,
    _searchLens: SearchLens,
    historyMode: HistoryMode = 'none'
  ) => {
    const normalizedSearchQuery = searchQuery.trim()
    if (!normalizedSearchQuery) return
    const searchLens: SearchLens = 'procurement'

    if (historyMode !== 'none') {
      const nextPath = buildSearchPath(
        window.location.pathname,
        window.location.search,
        normalizedSearchQuery,
        searchLens,
        window.location.hash
      )
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (nextPath !== currentPath) {
        const method = historyMode === 'push' ? 'pushState' : 'replaceState'
        window.history[method]({}, '', nextPath)
      }
    }

    const sequence = searchSequence.current + 1
    searchSequence.current = sequence
    abortActiveWork()
    const controller = new AbortController()
    searchController.current = controller

    setIsLoading(true)
    setIsEnriching(false)
    setScrapedResults([])
    setResultBuckets(EMPTY_BUCKETS)
    setValidationProgress(null)
    setRetrievalStatus(null)
    setEnrichmentError(null)
    setError(null)
    setIntelligence(null)
    setSuggestions([])
    setHasSearched(false)
    setSearchTime(0)
    const startTime = performance.now()

    try {
      const planResponse = await fetchWithTimeout('/api/search/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: normalizedSearchQuery, maxSearches: 8 }),
      }, PLAN_TIMEOUT_MS, controller.signal)
      const searchPlan = await planResponse.json().catch(() => null) as (ServerSearchPlan & {
        error?: string
        detail?: string
      }) | null
      if (!planResponse.ok || !searchPlan?.query || !Array.isArray(searchPlan.searches)) {
        throw new Error(searchPlan?.detail || searchPlan?.error || 'Ultra Search could not build the Occu-Med search plan.')
      }
      if (searchSequence.current !== sequence) return

      const plannedQueries = searchPlan.searches.map(search => search.query)
      setSuggestions(searchSuggestions(plannedQueries))
      setLens('procurement')

      const serverBatch = await runServerSearchPlan(searchPlan, {
        timeoutMs: 70_000,
        signal: controller.signal,
      })
      if (searchSequence.current !== sequence) return

      const transport = serverBatch.transport || 'unknown'
      setRetrievalStatus({
        transport,
        attemptedSearches: serverBatch.attemptedSearches,
        successfulSearches: serverBatch.successfulSearches,
        engines: serverBatch.engines,
        diagnostics: serverBatch.diagnostics || [],
      })

      const ingestResponse = await fetchWithTimeout('/api/search/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchPlan.query,
          intent: searchPlan.intent,
          searches: searchPlan.searches,
          results: serverBatch.results,
          transport: serverBatch.transport,
          settings: toSearchRequestPreferences(settings),
        }),
      }, INGEST_TIMEOUT_MS, controller.signal)
      const payload = await ingestResponse.json().catch(() => null) as SearchPayload | null
      if (!ingestResponse.ok) {
        throw new Error(payload?.detail || payload?.error || `Search result filtering failed (HTTP ${ingestResponse.status}).`)
      }
      if (!payload?.query || !payload.lens || !payload.timestamp) {
        throw new Error('Search result filtering returned an incomplete response.')
      }
      if (searchSequence.current !== sequence) return

      const data = {
        query: payload.query,
        lens: payload.lens,
        summary: payload.summary,
        expandedQueries: payload.expandedQueries ?? plannedQueries,
        signals: payload.signals ?? [],
        results: payload.results ?? [],
        sources: payload.sources ?? serverBatch.engines,
        timestamp: payload.timestamp,
        confidence: payload.confidence ?? 0,
        intent: payload.intent || searchPlan.intent,
      }

      setIntelligence({
        query: data.query,
        lens: data.lens,
        summary: data.results.length > 0 ? undefined : data.summary,
        confidence: data.results.length > 0 ? 0 : data.confidence,
        signals: data.signals,
        sources: data.sources,
        queryExpansions: data.expandedQueries,
        timestamp: data.timestamp,
        note: `Retrieval: ${transport}; ${serverBatch.successfulSearches}/${serverBatch.attemptedSearches} planned searches returned candidates.`,
      })
      setScrapedResults(data.results)
      setHasSearched(true)
      setSearchTime(performance.now() - startTime)
      setIsLoading(false)
      setSuggestions(searchSuggestions(data.expandedQueries))

      if (data.results.length > 0) {
        void runStreamingValidation(data.query, data.lens, data.results, sequence, data.intent)
      }

      try {
        const stored = localStorage.getItem('search_history')
        const history = stored ? (JSON.parse(stored) as Array<Record<string, unknown>>) : []
        const nextEntry = {
          query: normalizedSearchQuery,
          normalized_query: data.query,
          lens: data.lens,
          vertical: data.lens,
          result_count: data.results.length,
          timestamp: new Date().toISOString(),
          retrieval_mode: transport,
          retrieval_engines: serverBatch.engines,
          attempted_searches: serverBatch.attemptedSearches,
          successful_searches: serverBatch.successfulSearches,
        }
        const nextHistory = [nextEntry, ...(Array.isArray(history) ? history : [])]
          .filter((entry, index, entries) => {
            const entryQuery = String(entry.query ?? '')
            return entries.findIndex(candidate => String(candidate.query ?? '') === entryQuery) === index
          })
          .slice(0, 100)
        localStorage.setItem('search_history', JSON.stringify(nextHistory))
      } catch {
        // Local history is optional; search remains functional without it.
      }
    } catch (searchError) {
      if (controller.signal.aborted || searchSequence.current !== sequence) return
      setScrapedResults([])
      setResultBuckets(EMPTY_BUCKETS)
      setValidationProgress(null)
      setHasSearched(true)
      setSearchTime(performance.now() - startTime)
      setError(searchError instanceof Error ? searchError.message : 'Search failed')
    } finally {
      if (searchController.current === controller) searchController.current = null
      if (searchSequence.current === sequence) setIsLoading(false)
    }
  }, [abortActiveWork, runStreamingValidation, settings])

  const performSearch = useCallback(
    async () => executeSearch(query, 'procurement', 'push'),
    [executeSearch, query]
  )

  useEffect(() => {
    const applyUrlState = () => {
      const requestedSearch = parseSearchUrl(window.location.search)
      if (!requestedSearch) {
        resetSearch()
        return
      }
      setQuery(requestedSearch.query)
      setLens('procurement')
      void executeSearch(requestedSearch.query, 'procurement', 'none')
    }

    if (!initializedFromUrl.current) {
      initializedFromUrl.current = true
      const requestedSearch = parseSearchUrl(window.location.search)
      if (requestedSearch) {
        setQuery(requestedSearch.query)
        setLens('procurement')
        void executeSearch(requestedSearch.query, 'procurement', 'none')
      }
    }

    window.addEventListener('popstate', applyUrlState)
    return () => window.removeEventListener('popstate', applyUrlState)
  }, [executeSearch, resetSearch])

  useEffect(() => () => abortActiveWork(), [abortActiveWork])

  return {
    query,
    setQuery,
    lens,
    setLens,
    intelligence,
    scrapedResults,
    resultBuckets,
    validationProgress,
    retrievalStatus,
    isLoading,
    isEnriching,
    enrichmentError,
    error,
    suggestions,
    hasSearched,
    searchTime,
    performSearch,
    settings,
  }
}
