'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  type IntelligenceObject,
  type ScrapedResult,
  type SearchLens,
  type SearchSuggestion,
} from '@/types/search'

interface UseSearchReturn {
  query: string
  setQuery: (q: string) => void
  lens: SearchLens
  setLens: (l: SearchLens) => void
  intelligence: IntelligenceObject | null
  scrapedResults: ScrapedResult[]
  isLoading: boolean
  error: string | null
  suggestions: SearchSuggestion[]
  hasSearched: boolean
  searchTime: number
  performSearch: () => Promise<void>
}

const VALID_LENSES = new Set<SearchLens>([
  'web',
  'pdf',
  'government',
  'procurement',
  'pricing',
  'provider',
  'technical',
  'news',
  'legal',
  'medical',
  'academic',
  'financial',
])

export function useSearch(): UseSearchReturn {
  const [query, setQuery] = useState('')
  const [lens, setLens] = useState<SearchLens>('web')
  const [intelligence, setIntelligence] = useState<IntelligenceObject | null>(null)
  const [scrapedResults, setScrapedResults] = useState<ScrapedResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [searchTime, setSearchTime] = useState(0)

  const executeSearch = useCallback(async (searchQuery: string, searchLens: SearchLens) => {
    if (!searchQuery.trim()) return

    setIsLoading(true)
    setError(null)
    const startTime = performance.now()

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, lens: searchLens }),
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
      } | null

      if (!response.ok) {
        const message = payload?.detail || payload?.error || response.statusText || `HTTP ${response.status}`
        throw new Error(`Search failed: ${message}`)
      }

      if (!payload?.query || !payload.lens || !payload.timestamp) {
        throw new Error('Search failed: the server returned an incomplete response')
      }

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
          query: searchQuery,
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
      setError(searchError instanceof Error ? searchError.message : 'Search failed')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const performSearch = useCallback(
    async () => executeSearch(query, lens),
    [executeSearch, lens, query]
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedQuery = params.get('q')?.trim() ?? ''
    const requestedLens = params.get('lens') as SearchLens | null

    if (!requestedQuery) return

    const resolvedLens = requestedLens && VALID_LENSES.has(requestedLens) ? requestedLens : 'web'
    setQuery(requestedQuery)
    setLens(resolvedLens)

    params.delete('q')
    params.delete('lens')
    const cleanUrl = params.size ? `/?${params.toString()}` : '/'
    window.history.replaceState({}, '', cleanUrl)

    void executeSearch(requestedQuery, resolvedLens)
  }, [executeSearch])

  return {
    query,
    setQuery,
    lens,
    setLens,
    intelligence,
    scrapedResults,
    isLoading,
    error,
    suggestions,
    hasSearched,
    searchTime,
    performSearch,
  }
}
