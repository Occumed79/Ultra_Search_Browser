'use client'

import {
  AlertTriangle,
  Database,
  HardDrive,
  History,
  RotateCcw,
  Search,
  Trash2,
  X,
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

function readLocalHistory(): HistoryRun[] {
  try {
    const stored = localStorage.getItem('search_history')
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? (parsed as HistoryRun[]) : []
  } catch {
    return []
  }
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<HistoryRun[] | null>(null)
  const [storageMode, setStorageMode] = useState<StorageMode>('database')
  const [filter, setFilter] = useState('')
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadHistory() {
      try {
        const response = await fetch('/api/history', { cache: 'no-store' })
        if (response.status === 501) {
          if (mounted) {
            setStorageMode('local')
            setRuns(readLocalHistory())
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
        if (mounted) {
          setStorageMode('local')
          setRuns(readLocalHistory())
          setError(loadError instanceof Error ? loadError.message : 'History could not be loaded')
        }
      }
    }

    void loadHistory()
    return () => {
      mounted = false
    }
  }, [])

  const visibleRuns = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return runs ?? []
    return (runs ?? []).filter(run => {
      const query = run.query ?? run.normalized_query ?? ''
      const lens = run.vertical ?? run.lens ?? 'web'
      return `${query} ${lens}`.toLowerCase().includes(needle)
    })
  }, [filter, runs])

  const resultTotal = useMemo(
    () => (runs ?? []).reduce((total, run) => total + (run.result_count ?? 0), 0),
    [runs]
  )

  function rerun(run: HistoryRun) {
    const query = run.query ?? run.normalized_query ?? ''
    const lens = run.vertical ?? run.lens ?? 'web'
    const params = new URLSearchParams({ q: query, lens })
    window.location.href = `/?${params.toString()}`
  }

  async function clearHistory() {
    if (!(runs?.length) || !window.confirm('Clear all search history?')) return
    setClearing(true)
    setError(null)

    try {
      if (storageMode === 'database') {
        const response = await fetch('/api/history?all=true', { method: 'DELETE' })
        if (!response.ok) throw new Error('History could not be cleared')
      }
      localStorage.removeItem('search_history')
      setRuns([])
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'History could not be cleared')
    } finally {
      setClearing(false)
    }
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

      <main className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        <section className="glass-surface overflow-hidden rounded-[24px]">
          <div className="border-b border-white/10 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-teal-200/65">
                  <History className="h-3.5 w-3.5" /> Search archive
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white/95">Search history</h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/45">
                  Find and rerun previous research without rebuilding the query from scratch.
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
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative flex-1">
                <span className="sr-only">Filter search history</span>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                <input
                  className="w-full rounded-xl border border-white/10 bg-white/[0.035] py-2.5 pl-10 pr-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-teal-200/25"
                  placeholder="Filter by query or lens"
                  value={filter}
                  onChange={event => setFilter(event.target.value)}
                />
              </label>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <div className="flex items-center gap-2 text-[11px] text-white/30">
                  {storageMode === 'database' ? <Database className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
                  {storageMode === 'database' ? 'Persistent history' : 'This browser'}
                </div>
                <button className="glass-button !px-3 text-[11px]" disabled={!runs?.length || clearing} onClick={() => void clearHistory()}>
                  <Trash2 className="h-3.5 w-3.5" /> {clearing ? 'Clearing...' : 'Clear all'}
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100/70">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span className="flex-1">{error}</span>
                <button aria-label="Dismiss message" onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button>
              </div>
            )}

            {runs === null ? (
              <div className="space-y-3" aria-label="Loading search history">
                {[0, 1, 2].map(item => (
                  <div key={item} className="h-24 animate-pulse rounded-2xl border border-white/5 bg-white/[0.035]" />
                ))}
              </div>
            ) : visibleRuns.length === 0 ? (
              <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[22px] border border-dashed border-white/15 bg-white/[0.025] px-6 text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/[0.08] shadow-[0_0_45px_rgba(92,229,204,0.10)]">
                  <Search className="h-7 w-7 text-teal-100/70" />
                </div>
                <h2 className="text-lg font-medium text-white/90">{filter ? 'No matching searches' : 'No searches yet'}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/45">
                  {filter ? 'Try a different query or lens name.' : 'Run your first search and it will appear here automatically.'}
                </p>
                {!filter && (
                  <a href="/" className="search-btn-glow mt-6 inline-flex items-center gap-2">
                    <Search className="h-3.5 w-3.5" /> Start searching
                  </a>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {visibleRuns.map((run, index) => {
                  const query = run.query ?? run.normalized_query ?? 'Untitled search'
                  const lens = run.vertical ?? run.lens ?? 'web'
                  const key = run.id ?? `${run.created_at ?? run.timestamp ?? 'run'}-${query}-${index}`
                  return (
                    <article
                      key={key}
                      className="result-card animate-in flex flex-col gap-4 sm:flex-row sm:items-center"
                      style={{ animationDelay: `${index * 35}ms` }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-teal-200/20 bg-teal-200/[0.08] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-teal-100/70">
                            {lens}
                          </span>
                          <span className="text-[11px] text-white/30">{formatDate(run.created_at ?? run.timestamp)}</span>
                        </div>
                        <h2 className="truncate text-[15px] font-medium text-white/90">{query}</h2>
                        <p className="mt-1 text-xs text-white/35">{run.result_count ?? 0} results</p>
                      </div>

                      <button className="glass-button flex-shrink-0" onClick={() => rerun(run)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Search again
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
