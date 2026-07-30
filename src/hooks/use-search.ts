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

interface UseSearchReturn {
  query: string
  setQuery: (q: string) => void
  lens: SearchLens
  setLens: (l: SearchLens) => void
  intelligence: IntelligenceObject | null
  scrapedResults: ScrapedResult[]
  resultBuckets: SearchResultBuckets
  validationProgress: SearchValidationProgress | null
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

const EMPTY_BUCKETS: SearchResultBuckets = {
  valid: [],
  uncertain: [],
  expired: [],
  dead: [],
  rejected: [],
  duplicate: [],
}

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

export function useSearch(): UseSearchReturn {
  const [storedSettings] = useLocalStorage<UserSettings>('user-settings', DEFAULT_USER_SETTINGS)
  const settings = useMemo(() => normalizeUserSettings(storedSettings), [storedSettings])
  const [query, setQuery] = useState('')
  const [lens, setLens] = useState<SearchLens>('web')
  const [intelligence, setIntelligence] = useState<IntelligenceObject | null>(null)
  const [scrapedResults, setScrapedResults] = useState<ScrapedResult[]>([])
  const [resultBuckets, setResultBuckets] = useState<SearchResultBuckets>(EMPTY_BUCKETS)
  const [validationProgress, setValidationProgress] = useState<SearchValidationProgress | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isEnriching, setIsEnriching] = useState(false)
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [searchTime, setSearchTime] = useState(0)
  const searchSequence = useRef(0)
  const validationController = useRef<AbortController | null>(null)
  const initializedFromUrl = useRef(false)

  const resetSearch = useCallback(() => {
    searchSequence.current += 1
    validationController.current?.abort()
    validationController.current = null
    setQuery('')
    setLens('web')
    setIntelligence(null)
    setScrapedResults([])
    setResultBuckets(EMPTY_BUCKETS)
    setValidationProgress(null)
    setIsLoading(false)
    setIsEnriching(false)
    setEnrichmentError(null)
    setError(null)
    setSuggestions([])
    setHasSearched(false)
    setSearchTime(0)
  }, [])

  const runFallbackEnrichment = useCallback(async (
    searchQuery: string,
    searchLens: SearchLens,
    results: ScrapedResult[],
    sequence: number,
    semanticIntent?: SemanticIntentPlan
  ) => {
    const response = await fetch('/api/search/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, lens: searchLens, results, intent: semanticIntent }),
    })
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
    setIsEnriching(true)
    setEnrichmentError(null)
    setValidationProgress({
      phase: 'opening-pages',
      total: Math.min(24, results.length),
      checked: 0,
      reachable: 0,
      valid: 0,
      uncertain: 0,
      expired: 0,
      dead: 0,
      rejected: 0,
      duplicates: 0,
    })

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
          if (searchSequence.current !== sequence) return
          const parsed = parseSseBlock(block)
          if (!parsed) continue

          if (parsed.event === 'progress') {
            const payload = parsed.data as { progress?: SearchValidationProgress }
            if (payload.progress) setValidationProgress(payload.progress)
          } else if (parsed.event === 'result') {
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
          } else if (parsed.event === 'complete') {
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
            completed = true
          } else if (parsed.event === 'error') {
            const payload = parsed.data as { detail?: string; error?: string }
            throw new Error(payload.detail || payload.error || 'Deep validation failed')
          }
        }
      }

      if (!completed) throw new Error('Validation stream ended before completion')
    } catch (validationFailure) {
      if (controller.signal.aborted || searchSequence.current !== sequence) return
      try {
        await runFallbackEnrichment(searchQuery, searchLens, results, sequence, semanticIntent)
      } catch (fallbackFailure) {
        if (searchSequence.current === sequence) {
          const primary = validationFailure instanceof Error ? validationFailure.message : 'Validation failed'
          const fallback = fallbackFailure instanceof Error ? fallbackFailure.message : 'Fallback enrichment failed'
          setEnrichmentError(`${primary}. ${fallback}`)
        }
      }
    } finally {
      if (validationController.current === controller) validationController.current = null
      if (searchSequence.current === sequence) setIsEnriching(false)
    }
  }, [runFallbackEnrichment])

  const executeSearch = useCallback(async (
    searchQuery: string,
    searchLens: SearchLens,
    historyMode: HistoryMode = 'none'
  ) => {
    const normalizedSearchQuery = searchQuery.trim()
    if (!normalizedSearchQuery) return

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
    validationController.current?.abort()
    validationController.current = null
    setIsLoading(true)
    setIsEnriching(false)
    setScrapedResults([])
    setResultBuckets(EMPTY_BUCKETS)
    setValidationProgress(null)
    setEnrichmentError(null)
    setError(null)
    const startTime = performance.now()

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: normalizedSearchQuery,
          lens: searchLens,
          settings: toSearchRequestPreferences(settings),
        }),
      })

      const payload = await response.json().catch(() => null) as {
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
      } | null

      if (!response.ok) {
        const message = payload?.detail || payload?.error || response.statusText || `HTTP ${response.status}`
        throw new Error(`Search failed: ${message}`)
      }

      if (!payload?.query || !payload.lens || !payload.timestamp) {
        throw new Error('Search failed: the server returned an incomplete response')
      }

      if (searchSequence.current !== sequence) return

      const data = {
        query: payload.query,
        lens: payload.lens,
        summary: payload.summary,
        expandedQueries: payload.expandedQueries ?? [],
        signals: payload.signals ?? [],
        results: payload.results ?? [],
        sources: payload.sources ?? [],
        timestamp: payload.timestamp,
        confidence: payload.confidence ?? 0,
        intent: payload.intent,
      }

      if (data.lens !== searchLens) {
        setLens(data.lens)
        const routedPath = buildSearchPath(
          window.location.pathname,
          window.location.search,
          normalizedSearchQuery,
          data.lens,
          window.location.hash
        )
        window.history.replaceState({}, '', routedPath)
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
      })
      // Search results are useful discovery candidates before the optional
      // destination-page review completes. Keep them visible and enhance them
      // in place as validation events arrive.
      setScrapedResults(data.results)
      setHasSearched(true)
      setSearchTime(performance.now() - startTime)
      setIsLoading(false)

      if (data.results.length > 0) {
        void runStreamingValidation(data.query, data.lens, data.results, sequence, data.intent)
      }

      setSuggestions(data.expandedQueries.length
        ? data.expandedQueries.map((text, index) => ({
            text,
            type: index === 0 ? ('related' as const) : ('ai' as const),
            score: 1 - index * 0.1,
          }))
        : [])

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
        }
        const nextHistory = [nextEntry, ...(Array.isArray(history) ? history : [])]
          .filter((entry, index, entries) => {
            const entryQuery = String(entry.query ?? '')
            return entries.findIndex(candidate => String(candidate.query ?? '') === entryQuery) === index
          })
          .slice(0, 100)
        localStorage.setItem('search_history', JSON.stringify(nextHistory))
      } catch {
        // Browser storage is an optional fallback; search remains functional without it.
      }
    } catch (searchError) {
      if (searchSequence.current === sequence) {
        setError(searchError instanceof Error ? searchError.message : 'Search failed')
      }
    } finally {
      if (searchSequence.current === sequence) setIsLoading(false)
    }
  }, [runStreamingValidation, settings])

  const performSearch = useCallback(
    async () => executeSearch(query, lens, 'push'),
    [executeSearch, lens, query]
  )

  useEffect(() => {
    const applyUrlState = () => {
      const requestedSearch = parseSearchUrl(window.location.search)
      if (!requestedSearch) {
        resetSearch()
        return
      }
      setQuery(requestedSearch.query)
      setLens(requestedSearch.lens)
      void executeSearch(requestedSearch.query, requestedSearch.lens, 'none')
    }

    if (!initializedFromUrl.current) {
      initializedFromUrl.current = true
      const requestedSearch = parseSearchUrl(window.location.search)
      if (requestedSearch) {
        setQuery(requestedSearch.query)
        setLens(requestedSearch.lens)
        void executeSearch(requestedSearch.query, requestedSearch.lens, 'none')
      }
    }

    window.addEventListener('popstate', applyUrlState)
    return () => window.removeEventListener('popstate', applyUrlState)
  }, [executeSearch, resetSearch])

  useEffect(() => () => validationController.current?.abort(), [])

  return {
    query,
    setQuery,
    lens,
    setLens,
    intelligence,
    scrapedResults,
    resultBuckets,
    validationProgress,
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
