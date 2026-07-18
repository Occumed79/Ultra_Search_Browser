import { readFileSync, writeFileSync } from 'node:fs'

function write(path, content) {
  writeFileSync(path, content.trimStart(), 'utf8')
}

function replaceRequired(path, search, replacement) {
  const current = readFileSync(path, 'utf8')
  if (!current.includes(search)) {
    throw new Error(`Required source text not found in ${path}: ${search.slice(0, 100)}`)
  }
  writeFileSync(path, current.replace(search, replacement), 'utf8')
}

write('src/app/api/bookmarks/route.ts', `
import { NextRequest, NextResponse } from 'next/server'
import { initializeSchema, insertBookmark } from '../../../lib/search-storage'
import { query } from '../../../lib/db'

export async function GET() {
  try {
    await initializeSchema()
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(
      'SELECT id, title, url, description, created_at FROM bookmarks ORDER BY created_at DESC LIMIT 500'
    )
    return NextResponse.json({ bookmarks: res?.rows ?? [] })
  } catch (error) {
    console.error('Failed to fetch bookmarks:', error)
    return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeSchema()
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const body = (await request.json()) as {
      title?: string
      url?: string
      description?: string
    }
    const url = body.url?.trim()
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    const bookmark = {
      id: crypto.randomUUID(),
      user_id: 'default',
      url,
      title: body.title?.trim() || url,
      description: body.description?.trim() || null,
    }
    const id = await insertBookmark(bookmark)

    return NextResponse.json({
      bookmark: {
        id,
        title: bookmark.title,
        url: bookmark.url,
        description: bookmark.description,
        created_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to create bookmark:', error)
    return NextResponse.json({ error: 'Failed to create bookmark' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeSchema()
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const id = request.nextUrl.searchParams.get('id')
    const url = request.nextUrl.searchParams.get('url')
    if (!id && !url) {
      return NextResponse.json({ error: 'id or url required' }, { status: 400 })
    }

    if (id) {
      await query('DELETE FROM bookmarks WHERE id = $1', [id])
    } else {
      await query('DELETE FROM bookmarks WHERE url = $1', [url])
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete bookmark:', error)
    return NextResponse.json({ error: 'Failed to delete bookmark' }, { status: 500 })
  }
}
`)

write('src/app/api/history/route.ts', `
import { NextResponse } from 'next/server'
import { query } from '../../../lib/db'

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(
      \`SELECT id, vertical, query, normalized_query, lens, created_at, result_count, sources
       FROM search_runs
       ORDER BY created_at DESC
       LIMIT 200\`
    )

    return NextResponse.json({ runs: res?.rows ?? [] })
  } catch (error) {
    console.error('Failed to fetch history:', error)
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}
`)

write('src/app/bookmarks/page.tsx', `
'use client'

import { useEffect, useState } from 'react'

interface BookmarkRecord {
  id: string
  title: string
  url: string
  description?: string | null
  created_at?: string
}

function readLocalBookmarks(): BookmarkRecord[] {
  try {
    const stored = localStorage.getItem('bookmarks')
    const value: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(value) ? (value as BookmarkRecord[]) : []
  } catch {
    return []
  }
}

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    let mounted = true

    fetch('/api/bookmarks')
      .then(async response => {
        if (response.status === 501) return { bookmarks: readLocalBookmarks() }
        if (!response.ok) throw new Error('Failed to load bookmarks')
        return (await response.json()) as { bookmarks?: BookmarkRecord[] }
      })
      .then(data => {
        if (mounted) setBookmarks(data.bookmarks ?? [])
      })
      .catch(error => {
        console.warn('Bookmarks fetch failed; using local storage:', error)
        if (mounted) setBookmarks(readLocalBookmarks())
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  function saveLocalBookmark(bookmark: BookmarkRecord) {
    const next = [bookmark, ...readLocalBookmarks().filter(item => item.url !== bookmark.url)]
    localStorage.setItem('bookmarks', JSON.stringify(next))
    setBookmarks(next)
  }

  async function handleAdd() {
    const normalizedUrl = url.trim()
    if (!normalizedUrl) return

    const fallback: BookmarkRecord = {
      id: 'local-' + Date.now(),
      title: title.trim() || normalizedUrl,
      url: normalizedUrl,
      created_at: new Date().toISOString(),
    }

    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: fallback.title, url: normalizedUrl }),
      })
      if (response.ok) {
        const data = (await response.json()) as { bookmark?: BookmarkRecord }
        if (data.bookmark) {
          setBookmarks(previous => [data.bookmark as BookmarkRecord, ...(previous ?? [])])
          setTitle('')
          setUrl('')
          return
        }
      }
    } catch (error) {
      console.warn('Server bookmark failed; saving locally:', error)
    }

    saveLocalBookmark(fallback)
    setTitle('')
    setUrl('')
  }

  async function handleDelete(bookmark: BookmarkRecord) {
    try {
      if (!bookmark.id.startsWith('local-')) {
        const response = await fetch('/api/bookmarks?id=' + encodeURIComponent(bookmark.id), {
          method: 'DELETE',
        })
        if (response.ok) {
          setBookmarks(previous => (previous ?? []).filter(item => item.id !== bookmark.id))
          return
        }
      }
    } catch (error) {
      console.warn('Server delete failed; removing local copy:', error)
    }

    const next = (bookmarks ?? []).filter(item => item.id !== bookmark.id)
    localStorage.setItem('bookmarks', JSON.stringify(next))
    setBookmarks(next)
  }

  if (loading && bookmarks === null) {
    return <div className="p-6">Loading...</div>
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Bookmarks</h1>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="flex-1 rounded border border-white/10 bg-transparent px-3 py-2"
          placeholder="Title"
          value={title}
          onChange={event => setTitle(event.target.value)}
        />
        <input
          className="flex-1 rounded border border-white/10 bg-transparent px-3 py-2"
          placeholder="https://..."
          value={url}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void handleAdd()
          }}
        />
        <button className="glass-button" onClick={() => void handleAdd()}>Add</button>
      </div>

      {!bookmarks?.length ? (
        <div className="text-sm text-muted-foreground">No bookmarks yet.</div>
      ) : (
        <div className="space-y-3">
          {bookmarks.map(bookmark => (
            <div
              key={bookmark.id || bookmark.url}
              className="flex items-center justify-between rounded-lg border border-[#233242] bg-[#0f1724] p-3"
            >
              <a
                href={bookmark.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-sm font-medium hover:underline"
              >
                {bookmark.title || bookmark.url}
              </a>
              <div className="ml-3 flex items-center gap-2">
                <button className="glass-button" onClick={() => window.open(bookmark.url, '_blank')}>Open</button>
                <button className="glass-button" onClick={() => void handleDelete(bookmark)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
`)

write('src/app/page.tsx', `
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
      return new URL(result.url).hostname.replace(/^www\./, '')
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
`)

replaceRequired(
  'src/lib/verticals/pricing/config.ts',
  "import type { SearchVerticalConfig } from '../verticals';",
  "import type { SearchVerticalConfig } from '../index';"
)

replaceRequired(
  'src/lib/search.ts',
  "const liveData = liveRes.status === 'fulfilled' ? (liveRes.value as any) : { text: '', sources: [], rawTexts: [], results: [] }",
  "const liveData: Awaited<ReturnType<typeof searchAllEngines>> = liveRes.status === 'fulfilled'\n    ? liveRes.value\n    : { text: '', sources: [], rawTexts: [], results: [] }"
)

replaceRequired(
  'src/lib/search.ts',
  "const text = result.title + ' ' + (result.description || '') + ' ' + (result as any).extracted_text || ''",
  "const text = [result.title, result.description || '', (result as any).extracted_text || ''].join(' ').trim()"
)

for (const [search, replacement] of [
  ['price: f.price ?? null', 'price: f.price ?? undefined'],
  ['price_text: f.price_text || null', 'price_text: f.price_text || undefined'],
  ['location: f.location || null', 'location: f.location || undefined'],
  ['phone: f.phone || null', 'phone: f.phone || undefined'],
  ['email: f.email || null', 'email: f.email || undefined'],
  ['evidence_text: f.evidence_text || null', 'evidence_text: f.evidence_text || undefined'],
]) {
  replaceRequired('src/lib/search.ts', search, replacement)
}

console.log('Production readiness fixes applied.')
