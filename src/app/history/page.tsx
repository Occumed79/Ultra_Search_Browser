'use client'

import {
  ArrowLeft,
  Bookmark,
  Clock3,
  Database,
  History,
  RotateCcw,
  Search,
  Settings,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type HistoryRun = {
  id?: string
  vertical?: string
  query?: string
  normalized_query?: string
  lens?: string
  created_at?: string
  timestamp?: string | number
  result_count?: number
  sources?: unknown
}

type StorageMode = 'database' | 'local'

function formatDate(value?: string | number) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<HistoryRun[] | null>(null)
  const [storageMode, setStorageMode] = useState<StorageMode>('database')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadHistory() {
      try {
        const response = await fetch('/api/history', { cache: 'no-store' })
        if (response.status === 501) {
          const stored = localStorage.getItem('search_history')
          const parsed = stored ? (JSON.parse(stored) as HistoryRun[]) : []
          if (mounted) {
            setStorageMode('local')
            setRuns(Array.isArray(parsed) ? parsed : [])
          }
          return
        }

        if (!response.ok) throw new Error('History could not be loaded')
        const payload = (await response.json()) as { runs?: HistoryRun[] }
        if (mounted) {
          setStorageMode('database')
          setRuns(payload.runs ?? [])
        }
      } catch (loadError) {
        const stored = localStorage.getItem('search_history')
        const parsed = stored ? (JSON.parse(stored) as HistoryRun[]) : []
        if (mounted) {
          setStorageMode('local')
          setRuns(Array.isArray(parsed) ? parsed : [])
          setError(loadError instanceof Error ? loadError.message : 'History could not be loaded')
        }
      }
    }

    void loadHistory()
    return () => {
      mounted = false
    }
  }, [])

  const resultTotal = useMemo(
    () => (runs ?? []).reduce((total, run) => total + (run.result_count ?? 0), 0),
    [runs]
  )

  function rerun(run: HistoryRun) {
    const query = run.query ?? run.normalized_query ?? ''
    const lens = run.vertical ?? run.lens ?? 'web'
    const params = new URLSearchParams({ q: query, lens })
    window.location.href = '/?' + params.toString()
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="liquid-bg">
        <div className="aurora-1" />
        <div className="aurora-2" />
        <div className="aurora-3" />
        <div className="glass-bubble bubble-1" />
        <div className="glass-bubble bubble-2" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <a href="/" className="text-sm font-semibold tracking-[0.22em] text-white/80">
          ULTRA SEARCH
        </a>
        <nav className="flex items-center gap-2">
          <a className="glass-button" href="/history" aria-current="page">
            <Clock3 className="h-3.5 w-3.5" /> History
          </a>
          <a className="glass-button" href="/bookmarks">
            <Bookmark className="h-3.5 w-3.5" /> Bookmarks
          </a>
          <a className="glass-button" href="/settings">
            <Settings className="h-3.5 w-3.5" /> Settings
          </a>
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        <a href="/" className="glass-button mb-6 w-fit">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to search
        </a>

        <section className="glass-surface overflow-hidden rounded-[24px]">
          <div className="border-b border-white/10 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-teal-200/65">
                  <History className="h-3.5 w-3.5" /> Search archive
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white/95">Search history</h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/45">
                  Reopen previous research without rebuilding the query from scratch.
                </p>
              </div>

              <div className="flex gap-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">Searches</div>
                  <div className="mt-1 text-xl font-semibold text-white/85">{runs?.length ?? '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">Results</div>
                  <div className="mt-1 text-xl font-semibold text-white/85">{runs ? resultTotal : '—'}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-7">
            {runs === null ? (
              <div className="space-y-3" aria-label="Loading search history">
                {[0, 1, 2].map(item => (
                  <div key={item} className="h-24 animate-pulse rounded-2xl border border-white/5 bg-white/[0.035]" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[22px] border border-dashed border-white/15 bg-white/[0.025] px-6 text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/[0.08] shadow-[0_0_45px_rgba(92,229,204,0.10)]">
                  <Search className="h-7 w-7 text-teal-100/70" />
                </div>
                <h2 className="text-lg font-medium text-white/90">No searches yet</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/45">
                  Run your first search and it will appear here automatically with its lens, result count, and timestamp.
                </p>
                <a href="/" className="search-btn-glow mt-6 inline-flex items-center gap-2">
                  <Search className="h-3.5 w-3.5" /> Start searching
                </a>
                <div className="mt-6 flex items-center gap-2 text-[11px] text-white/30">
                  <Database className="h-3.5 w-3.5" />
                  {storageMode === 'database' ? 'Connected history storage' : 'Local history storage'}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {runs.map((run, index) => {
                  const query = run.query ?? run.normalized_query ?? 'Untitled search'
                  const lens = run.vertical ?? run.lens ?? 'web'
                  return (
                    <article
                      key={run.id ?? String(run.timestamp) ?? query + index}
                      className="result-card animate-in flex flex-col gap-4 sm:flex-row sm:items-center"
                      style={{ animationDelay: index * 35 + 'ms' }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-teal-200/20 bg-teal-200/[0.08] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-teal-100/70">
                            {lens}
                          </span>
                          <span className="text-[11px] text-white/30">
                            {formatDate(run.created_at ?? run.timestamp)}
                          </span>
                        </div>
                        <h2 className="truncate text-[15px] font-medium text-white/90">{query}</h2>
                        <p className="mt-1 text-xs text-white/35">
                          {run.result_count ?? 0} results
                        </p>
                      </div>

                      <button className="glass-button flex-shrink-0" onClick={() => rerun(run)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Search again
                      </button>
                    </article>
                  )
                })}
              </div>
            )}

            {error && (
              <p className="mt-4 text-center text-xs text-amber-200/55">
                Database history was unavailable, so local history was shown instead.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
