'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type IntelligenceObject,
  type ScrapedResult,
  type SearchLens,
  type SearchSuggestion,
  type UserSettings,
} from '@/types/search'
import { useLocalStorage } from './use-local-storage'
import { DEFAULT_USER_SETTINGS, normalizeUserSettings, toSearchRequestPreferences } from '@/lib/search-settings'
import { buildSearchPath, parseSearchUrl } from '@/lib/search-url'

interface UseSearchReturn {
  query: string
  setQuery: (q: string) => void
  lens: SearchLens
  setLens: (l: SearchLens) => void
  intelligence: IntelligenceObject | null
  scrapedResults: ScrapedResult[]
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

export function useSearch(): UseSearchReturn {
  const [storedSettings] = useLocalStorage<UserSettings>('user-settings', DEFAULT_USER_SETTINGS)
  const settings = useMemo(() => normalizeUserSettings(storedSettings), [storedSettings])
  const [query, setQuery] = useState('')
  const [lens, setLens] = useState<SearchLens>('web')
  const [intelligence, setIntelligence] = useState<IntelligenceObject | null>(null)
  const [scrapedResults, setScrapedResults] = useState<ScrapedResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isEnriching, setIsEnriching] = useState(false)
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [searchTime, setSearchTime] = useState(0)
  const searchSequence = useRef(0)
  const initializedFromUrl = useRef(false)

  const resetSearch = useCallback(() => {
    searchSequence.current += 1
    setQuery('')
    setLens('web')
    setIntelligence(null)
    setScrapedResults([])
    setIsLoading(false)
    setIsEnriching(false)
    setEnrichmentError(null)
    setError(null)
    setSuggestions([])
    setHasSearched(false)
    setSearchTime(0)
  }, [])

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
    setIsLoading(true)
    setIsEnriching(false)
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
        summary?: string
        expandedQueries?: string[]
        signals?: Array<{ name: string; score: number; description: string }>
        results?: ScrapedResult[]
        sources?: string[]
        timestamp?: string
        confidence?: number
        searchRunId?: string | null
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
      }

      setIntelligence({
        query: data.query,
        lens: data.lens,
        summary: data.summary,
        confidence: data.confidence,
        signals: data.signals,
        sources: data.sources,
        queryExpansions: data.expandedQueries,
        timestamp: data.timestamp,
      })
      setScrapedResults(data.results)
      setHasSearched(true)
      setSearchTime(performance.now() - startTime)
      setIsLoading(false)

      if (data.results.length > 0) {
        setIsEnriching(true)
        void fetch('/api/search/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: data.query,
            lens: data.lens,
            results: data.results,
            searchRunId: payload.searchRunId ?? null,
          }),
        })
          .then(async response => {
            const enrichment = await response.json().catch(() => null) as {
              results?: ScrapedResult[]
              error?: string
              detail?: string
            } | null

            if (!response.ok) {
              throw new Error(enrichment?.detail || enrichment?.error || 'Enrichment failed')
            }

            if (searchSequence.current === sequence && enrichment?.results) {
              setScrapedResults(enrichment.results)
            }
          })
          .catch(enrichmentFailure => {
            if (searchSequence.current === sequence) {
              setEnrichmentError(
                enrichmentFailure instanceof Error ? enrichmentFailure.message : 'Enrichment failed'
              )
            }
          })
          .finally(() => {
            if (searchSequence.current === sequence) setIsEnriching(false)
          })
      }

      if (data.expandedQueries.length) {
        setSuggestions(
          data.expandedQueries.map((text, index) => ({
            text,
            type: index === 0 ? ('related' as const) : ('ai' as const),
            score: 1 - index * 0.1,
          }))
        )
      } else {
        setSuggestions([])
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
  }, [settings])

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

  return {
    query,
    setQuery,
    lens,
    setLens,
    intelligence,
    scrapedResults,
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
