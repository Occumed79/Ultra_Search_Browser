'use client'

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Command,
  Download,
  ExternalLink,
  Filter,
  Link2,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ResultActions } from '../components/result-actions'
import { useSearch } from '../hooks/use-search'
import type { ResultBucket, ScrapedResult, UserSettings } from '../types/search'

const SOURCE_COLORS: Record<string, string> = {
  Google: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  Bing: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  DuckDuckGo: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  Brave: 'bg-amber-500/10 text-amber-200 border-amber-500/30',
  Mojeek: 'bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/30',
  Yahoo: 'bg-purple-500/10 text-purple-200 border-purple-500/30',
  SearXNG: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  'Gemini Google Search': 'bg-cyan-500/10 text-cyan-200 border-cyan-500/30',
  'memory-vector': 'bg-teal-500/10 text-teal-300 border-teal-500/30',
}

const BUCKET_LABELS: Record<ResultBucket, string> = {
  valid: 'Valid',
  uncertain: 'Uncertain',
  expired: 'Expired / closed',
  dead: 'Dead',
  rejected: 'Rejected',
  duplicate: 'Duplicates',
}

const BUCKET_STYLES: Record<ResultBucket, string> = {
  valid: 'border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100/75',
  uncertain: 'border-amber-300/20 bg-amber-300/[0.06] text-amber-100/70',
  expired: 'border-orange-300/20 bg-orange-300/[0.06] text-orange-100/70',
  dead: 'border-red-300/20 bg-red-300/[0.06] text-red-100/65',
  rejected: 'border-white/10 bg-white/[0.04] text-white/45',
  duplicate: 'border-violet-300/20 bg-violet-300/[0.06] text-violet-100/65',
}

type SortMode = 'score' | 'rank' | 'source'
type ResultWithId = ScrapedResult & { id?: string }

interface DomainPreference {
  domain: string
  action: string
}

function SearchResultCard({ result, index, settings }: { result: ResultWithId; index: number; settings: UserSettings }) {
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
  const lifecycle = result.pageValidation?.lifecycle
  const bucket = result.bucket || (result.validation?.status === 'valid' ? 'valid' : 'uncertain')
  const verified = result.pageValidation?.availability === 'reachable'

  return (
    <article className="result-card animate-in" style={{ animationDelay: index * 35 + 'ms' }}>
      <div className="flex items-start gap-3">
        {settings.showFavicons && (
          <img
            src={'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32'}
            alt=""
            className="mt-0.5 h-5 w-5 flex-shrink-0 rounded opacity-60"
            onError={event => {
              event.currentTarget.style.display = 'none'
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={'rounded-full border px-2 py-0.5 text-[10px] font-medium ' + sourceStyle}>
              {result.source}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-white/30">
              <Clock className="h-2.5 w-2.5" />#{result.rank || index + 1}
            </span>
            {verified && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/[0.07] px-2 py-0.5 text-[10px] text-emerald-100/75">
                <ShieldCheck className="h-2.5 w-2.5" /> Page verified
              </span>
            )}
            {result.bucket && (
              <span className={'rounded-full border px-2 py-0.5 text-[10px] ' + BUCKET_STYLES[bucket]}>
                {BUCKET_LABELS[bucket]}
              </span>
            )}
            {lifecycle && (
              <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.05] px-2 py-0.5 text-[10px] text-cyan-100/65">
                {lifecycle.status}
              </span>
            )}
            {result.entity && result.entity.confirmationCount > 1 && (
              <span className="rounded-full border border-violet-300/15 bg-violet-300/[0.05] px-2 py-0.5 text-[10px] text-violet-100/65">
                {result.entity.confirmationCount} sources confirm
              </span>
            )}
            {domainPreference && (
              <span className="rounded-full border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-300">
                {domainPreference}
              </span>
            )}
            {result.extractionDiagnostics?.extractionSucceeded && (
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-2 py-0.5 text-[10px] text-cyan-100/70">
                {result.extractionDiagnostics.extractionType.toUpperCase()} inspected
              </span>
            )}
          </div>

          <a href={result.url} target={settings.openInNewTab ? '_blank' : undefined} rel={settings.openInNewTab ? 'noopener noreferrer' : undefined} className="block">
            <h2 className="line-clamp-2 text-[14px] font-medium text-white/85 transition-colors hover:text-teal-300/90">
              {result.title}
            </h2>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-teal-400/50">{result.url}</p>
          </a>

          {settings.showDescriptions && result.description && (
            <p className="mt-1.5 line-clamp-3 text-[13px] text-white/40">{result.description}</p>
          )}

          {(result.validation?.reason || lifecycle?.reason) && (
            <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2 text-[11px] leading-relaxed text-white/50">
              <span className="font-medium text-white/65">Ranking note:</span>{' '}
              {result.validation?.reason || lifecycle?.reason}
            </div>
          )}

          {result.pageValidation?.evidence && result.pageValidation.evidence.length > 0 && (
            <details className="mt-2 rounded-lg border border-teal-300/10 bg-teal-300/[0.025] px-3 py-2">
              <summary className="cursor-pointer text-[11px] text-teal-100/55">View page evidence</summary>
              <div className="mt-2 space-y-2">
                {result.pageValidation.evidence.map((evidence, evidenceIndex) => (
                  <p key={evidenceIndex} className="text-[11px] leading-relaxed text-white/40">{evidence}</p>
                ))}
              </div>
            </details>
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
              target={settings.openInNewTab ? '_blank' : undefined}
              rel={settings.openInNewTab ? 'noopener noreferrer' : undefined}
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
    intelligence,
    scrapedResults,
    resultBuckets,
    validationProgress,
    isLoading,
    isEnriching,
    enrichmentError,
    error,
    hasSearched,
    searchTime,
    performSearch,
    settings,
  } = useSearch()
  const [sortMode, setSortMode] = useState<SortMode>('score')
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!settings.keyboardShortcuts) return
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [settings.keyboardShortcuts])

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

  const excludedBuckets = useMemo(() => (
    (['expired', 'dead', 'rejected', 'duplicate'] as ResultBucket[])
      .map(bucket => ({ bucket, results: resultBuckets[bucket] }))
      .filter(item => item.results.length > 0)
  ), [resultBuckets])
  const excludedCount = excludedBuckets.reduce((total, item) => total + item.results.length, 0)

  async function copySearchLink() {
    const value = window.location.href
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }

    setLinkCopied(true)
    window.setTimeout(() => setLinkCopied(false), 1600)
  }

  function exportResults(format: 'json' | 'csv') {
    const safeQuery = query.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 50) || 'search'
    const timestamp = new Date().toISOString().replaceAll(':', '-')
    let content: string
    let type: string

    if (format === 'json') {
      content = JSON.stringify(
        { metadata: { query, lens, timestamp, resultCount: visibleResults.length }, results: visibleResults, buckets: resultBuckets },
        null,
        2
      )
      type = 'application/json'
    } else {
      const escape = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"'
      const rows = visibleResults.map(result =>
        [result.title, result.url, result.description, result.source, result.score, result.rank, result.bucket, result.pageValidation?.lifecycle.status]
          .map(escape)
          .join(',')
      )
      content = ['Title,URL,Description,Source,Score,Rank,Bucket,Status', ...rows].join('\n')
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

      <main
        className="relative z-10 mx-auto flex w-full max-w-3xl flex-col px-4 pb-16"
        style={{ paddingTop: hasSearched ? '2px' : 'clamp(7vh, 11vh, 120px)' }}
      >
        <Link
          href="/"
          className="logo-glow mb-5 flex justify-center"
          aria-label="Occu-Med search home"
        >
          <img
            src="/brand/logo.png"
            alt="Occu-Med"
            className="h-auto w-[230px] object-contain sm:w-[285px]"
          />
        </Link>

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
          {settings.keyboardShortcuts && (
            <kbd className="hidden items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/40 sm:flex">
              <Command className="h-3 w-3" />K
            </kbd>
          )}
          <button className="search-btn-glow" disabled={isLoading} onClick={() => void performSearch()}>
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {hasSearched && (
          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
                <span>{visibleResults.length} ranked results · {searchTime.toFixed(0)}ms initial search</span>
                {isEnriching && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-2 py-1 text-[10px] text-cyan-100/65">
                    <Sparkles className="h-3 w-3 animate-pulse" /> Opening and validating pages
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="glass-button text-[11px]" onClick={() => void copySearchLink()}>
                  {linkCopied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                  {linkCopied ? 'Copied' : 'Copy link'}
                </button>
                <button className="glass-button text-[11px]" onClick={() => setShowFilters(show => !show)}>
                  <Filter className="h-3 w-3" /> Filters
                </button>
              </div>
            </div>

            {validationProgress && (
              <div className="glass-surface animate-in mb-4 rounded-xl p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] text-white/50">
                  <span className="capitalize">{validationProgress.phase.replaceAll('-', ' ')}</span>
                  <span>{validationProgress.checked}/{validationProgress.total} pages checked</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-teal-300/60 transition-all duration-300"
                    style={{ width: `${validationProgress.total ? Math.min(100, validationProgress.checked / validationProgress.total * 100) : 0}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/40">
                  <span>{validationProgress.reachable} reachable</span>
                  <span>{validationProgress.valid} valid</span>
                  <span>{validationProgress.uncertain} uncertain</span>
                  <span>{validationProgress.expired} expired/closed</span>
                  <span>{validationProgress.dead} dead</span>
                  <span>{validationProgress.rejected} junk</span>
                  <span>{validationProgress.duplicates} duplicates</span>
                </div>
              </div>
            )}

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

            {enrichmentError && (
              <div className="mb-4 flex gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100/65">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Deep validation did not finish, so the fast search results remain available.
              </div>
            )}

            {settings.autoSummarize && intelligence?.summary && (
              <div className="glass-surface animate-in mb-5 rounded-xl p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-teal-300/80" />
                  <h1 className="text-[13px] font-medium text-white/80">Search intelligence</h1>
                  <span className="ml-auto text-[10px] text-white/40">{intelligence.confidence}% confidence</span>
                </div>
                <p className="text-[13px] leading-relaxed text-white/50">
                  {intelligence.summary}
                </p>
              </div>
            )}

            <div className="space-y-3">
              {visibleResults.map((result, index) => (
                <SearchResultCard key={result.url + '-' + index} result={result} index={index} settings={settings} />
              ))}
            </div>

            {excludedCount > 0 && (
              <details className="glass-surface mt-5 rounded-xl p-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] text-white/55">
                  <ChevronDown className="h-4 w-4" />
                  {excludedCount} results removed after validation
                  <span className="ml-auto text-[10px] text-white/30">review buckets</span>
                </summary>
                <div className="mt-3 space-y-4">
                  {excludedBuckets.map(({ bucket, results }) => (
                    <div key={bucket}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className={'rounded-full border px-2 py-1 text-[10px] ' + BUCKET_STYLES[bucket]}>
                          {BUCKET_LABELS[bucket]} · {results.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {results.slice(0, 12).map(result => (
                          <a
                            key={`${bucket}-${result.url}`}
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2 hover:border-white/15"
                          >
                            <p className="line-clamp-1 text-[11px] text-white/60">{result.title}</p>
                            <p className="mt-1 line-clamp-2 text-[10px] text-white/35">
                              {result.pageValidation?.lifecycle.reason || result.pageValidation?.reason || result.validation?.reason}
                            </p>
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {!isLoading && !error && visibleResults.length === 0 && (
              <div className="py-12 text-center text-sm text-white/40">No ranked results found.</div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
