'use client'

import {
  AlertTriangle,
  Bookmark,
  ChevronRight,
  Clock,
  Command,
  Download,
  ExternalLink,
  Filter,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ResultActions } from '../components/result-actions'
import { useSearch } from '../hooks/use-search'
import type { ScrapedResult, SearchLens } from '../types/search'

const LENSES: Array<{ id: SearchLens; label: string }> = [
  { id: 'web', label: 'Web' },
  { id: 'pdf', label: 'PDF' },
  { id: 'government', label: 'Government' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'provider', label: 'Provider' },
  { id: 'technical', label: 'Technical' },
  { id: 'news', label: 'News' },
  { id: 'legal', label: 'Legal' },
  { id: 'medical', label: 'Medical' },
  { id: 'academic', label: 'Academic' },
  { id: 'financial', label: 'Financial' },
]

const SOURCE_COLORS: Record<string, string> = {
  Google: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  Bing: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  DuckDuckGo: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  SearXNG: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  'memory-vector': 'bg-teal-500/10 text-teal-300 border-teal-500/30',
}

type SortMode = 'score' | 'rank' | 'source'
type ResultWithId = ScrapedResult & { id?: string }

interface DomainPreference {
  domain: string
  action: string
}

function SearchResultCard({ result, index }: { result: ResultWithId; index: number }) {
  const domain = useMemo(() => {
    try {
      return new URL(result.url).hostname.replace(/^www./, '')
    } catch {
      return result.domain || ''
    }
  }, [result.domain, result.url])
  const [domainPreference, setDomainPreference] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/domain-preferences?userId=default')
      .then(async response => {
        if (!response.ok) return null
        return (await response.json()) as { preferences?: DomainPreference[] }
      })
      .then(data => {
        if (!mounted || !data) return
        const match = (data.preferences ?? []).find(item => item.domain === domain.toLowerCase())
        setDomainPreference(match?.action ?? null)
      })
      .catch(() => undefined)

    return () => {
      mounted = false
    }
  }, [domain])

  const sourceStyle = SOURCE_COLORS[result.source] ?? 'bg-white/5 text-white/40 border-white/10'
  const intelligenceEntries = result.intelligence
    ? Object.entries(result.intelligence as unknown as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .slice(0, 6)
    : []

  return (
    <article className="result-card animate-in" style={{ animationDelay: index * 35 + 'ms' }}>
      <div className="flex items-start gap-3">
        <img
          src={'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32'}
          alt=""
          className="mt-0.5 h-5 w-5 flex-shrink-0 rounded opacity-60"
          onError={event => {
            event.currentTarget.style.display = 'none'
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={'rounded-full border px-2 py-0.5 text-[10px] font-medium ' + sourceStyle}>
              {result.source}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-white/30">
              <Clock className="h-2.5 w-2.5" />#{result.rank || index + 1}
            </span>
            {domainPreference && (
              <span className="rounded-full border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-300">
                {domainPreference}
              </span>
            )}
          </div>

          <a href={result.url} target="_blank" rel="noopener noreferrer" className="block">
            <h2 className="line-clamp-2 text-[14px] font-medium text-white/85 transition-colors hover:text-teal-300/90">
              {result.title}
            </h2>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-teal-400/50">{result.url}</p>
          </a>

          {result.description && (
            <p className="mt-1.5 line-clamp-3 text-[13px] text-white/40">{result.description}</p>
          )}

          {intelligenceEntries.length > 0 && (
            <div className="mt-2.5 grid gap-1 rounded-lg border border-white/5 bg-white/3 p-2.5 sm:grid-cols-2">
              {intelligenceEntries.map(([key, value]) => (
                <div key={key} className="text-[11px] text-white/45">
                  <span className="text-white/65">{key.replaceAll('_', ' ')}:</span>{' '}
                  {Array.isArray(value) ? value.join(', ') : String(value)}
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-teal-300/60 hover:text-teal-300/90"
            >
              <ExternalLink className="h-3 w-3" /> Visit
            </a>
            <span className="text-[11px] text-white/25">{domain}</span>
            <div className="ml-auto">
              <ResultActions url={result.url} resultId={result.id} domain={domain} />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

export default function Home() {
  const {
    query,
    setQuery,
    lens,
    setLens,
    intelligence,
    scrapedResults,
    isLoading,
    error,
    hasSearched,
    searchTime,
    performSearch,
  } = useSearch()
  const [sortMode, setSortMode] = useState<SortMode>('score')
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [lensOpen, setLensOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [])

  const sources = useMemo(
    () => Array.from(new Set(scrapedResults.map(result => result.source))),
    [scrapedResults]
  )

  const visibleResults = useMemo(() => {
    const filtered = filterSource
      ? scrapedResults.filter(result => result.source === filterSource)
      : [...scrapedResults]
    return filtered.sort((left, right) => {
      if (sortMode === 'rank') return left.rank - right.rank
      if (sortMode === 'source') return left.source.localeCompare(right.source)
      return right.score - left.score
    })
  }, [filterSource, scrapedResults, sortMode])

  function exportResults(format: 'json' | 'csv') {
    const safeQuery = query.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 50) || 'search'
    const timestamp = new Date().toISOString().replaceAll(':', '-')
    let content: string
    let type: string

    if (format === 'json') {
      content = JSON.stringify(
        { metadata: { query, lens, timestamp, resultCount: visibleResults.length }, results: visibleResults },
        null,
        2
      )
      type = 'application/json'
    } else {
      const escape = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"'
      const rows = visibleResults.map(result =>
        [result.title, result.url, result.description, result.source, result.score, result.rank]
          .map(escape)
          .join(',')
      )
      content = ['Title,URL,Description,Source,Score,Rank', ...rows].join('\n')
      type = 'text/csv'
    }

    const objectUrl = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = 'search-results-' + safeQuery + '-' + timestamp + '.' + format
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  }

  return (
    <div className="relative min-h-screen">
      <div className="liquid-bg">
        <div className="aurora-1" />
        <div className="aurora-2" />
        <div className="aurora-3" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <a href="/" className="text-sm font-semibold tracking-[0.22em] text-white/80">ULTRA SEARCH</a>
        <nav className="flex items-center gap-2">
          <a className="glass-button" href="/history"><Clock className="h-3.5 w-3.5" /> History</a>
          <a className="glass-button" href="/bookmarks"><Bookmark className="h-3.5 w-3.5" /> Bookmarks</a>
          <a className="glass-button" href="/settings"><Settings className="h-3.5 w-3.5" /> Settings</a>
        </nav>
      </header>

      <main
        className="relative z-10 mx-auto flex w-full max-w-3xl flex-col px-4 pb-16"
        style={{ paddingTop: hasSearched ? '16px' : '12vh' }}
      >
        <div className="search-pill flex items-center gap-3 px-5 py-3">
          <Search className="h-5 w-5 flex-shrink-0 text-white/40" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void performSearch()
            }}
            placeholder="Search the web, documents, bids, pricing, providers..."
            className="flex-1 border-none bg-transparent text-[15px] text-white/90 outline-none placeholder:text-white/35"
          />
          <kbd className="hidden items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/40 sm:flex">
            <Command className="h-3 w-3" />K
          </kbd>
          <button className="search-btn-glow" disabled={isLoading} onClick={() => void performSearch()}>
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <div className="relative mt-4 flex items-center gap-3">
          <button className="glass-button" onClick={() => setLensOpen(open => !open)}>
            <ChevronRight className={'h-4 w-4 transition-transform ' + (lensOpen ? 'rotate-90' : '')} />
            {LENSES.find(item => item.id === lens)?.label}
          </button>
          {lensOpen && (
            <div className="lens-cluster animate-in absolute left-0 top-12 z-20 min-w-[300px]">
              {LENSES.map(item => (
                <button
                  key={item.id}
                  className={'lens-pill ' + (lens === item.id ? 'active' : '')}
                  onClick={() => {
                    setLens(item.id)
                    setLensOpen(false)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {hasSearched && (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div className="text-xs text-white/40">
                {visibleResults.length} results · {searchTime.toFixed(0)}ms
              </div>
              <button className="glass-button text-[11px]" onClick={() => setShowFilters(show => !show)}>
                <Filter className="h-3 w-3" /> Filters
              </button>
            </div>

            {showFilters && (
              <div className="glass-surface animate-in mb-4 flex flex-wrap items-center gap-3 rounded-xl p-3">
                <label className="flex items-center gap-2 text-[11px] text-white/40">
                  Sort
                  <select
                    value={sortMode}
                    onChange={event => setSortMode(event.target.value as SortMode)}
                    className="rounded border border-white/10 bg-black/30 px-2 py-1 text-white/70"
                  >
                    <option value="score">Score</option>
                    <option value="rank">Rank</option>
                    <option value="source">Source</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[11px] text-white/40">
                  Source
                  <select
                    value={filterSource ?? ''}
                    onChange={event => setFilterSource(event.target.value || null)}
                    className="rounded border border-white/10 bg-black/30 px-2 py-1 text-white/70"
                  >
                    <option value="">All</option>
                    {sources.map(source => <option key={source} value={source}>{source}</option>)}
                  </select>
                </label>
                {filterSource && (
                  <button className="glass-button text-[11px]" onClick={() => setFilterSource(null)}>
                    <X className="h-3 w-3" /> Clear
                  </button>
                )}
                <div className="ml-auto flex gap-2">
                  <button className="glass-button text-[11px]" onClick={() => exportResults('json')}>
                    <Download className="h-3 w-3" /> JSON
                  </button>
                  <button className="glass-button text-[11px]" onClick={() => exportResults('csv')}>
                    <Download className="h-3 w-3" /> CSV
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-4 flex gap-2 rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
              </div>
            )}

            {intelligence && (
              <div className="glass-surface animate-in mb-5 rounded-xl p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-teal-300/80" />
                  <h1 className="text-[13px] font-medium text-white/80">Search intelligence</h1>
                  <span className="ml-auto text-[10px] text-white/40">{intelligence.confidence}% confidence</span>
                </div>
                <p className="text-[13px] leading-relaxed text-white/50">
                  {intelligence.summary || 'Results for "' + intelligence.query + '" using the ' + intelligence.lens + ' lens.'}
                </p>
              </div>
            )}

            <div className="space-y-3">
              {visibleResults.map((result, index) => (
                <SearchResultCard key={result.url + '-' + index} result={result} index={index} />
              ))}
            </div>

            {!isLoading && visibleResults.length === 0 && (
              <div className="py-12 text-center text-sm text-white/40">No results found.</div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
