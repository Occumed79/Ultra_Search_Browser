'use client'

import {
  AlertTriangle,
  Bookmark,
  Database,
  ExternalLink,
  HardDrive,
  Link2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface BookmarkRecord {
  id: string
  title: string
  url: string
  description?: string | null
  created_at?: string
}

type StorageMode = 'database' | 'local'

function readLocalBookmarks(): BookmarkRecord[] {
  try {
    const stored = localStorage.getItem('bookmarks')
    const value: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(value) ? (value as BookmarkRecord[]) : []
  } catch {
    return []
  }
}

function normalizeUrl(value: string) {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`
  try {
    const parsed = new URL(candidate)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}

function formatDate(value?: string) {
  if (!value) return 'Recently saved'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently saved'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function bookmarkDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function upsertBookmark(items: BookmarkRecord[], bookmark: BookmarkRecord) {
  return [bookmark, ...items.filter(item => item.id !== bookmark.id && item.url !== bookmark.url)]
}

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[] | null>(null)
  const [storageMode, setStorageMode] = useState<StorageMode>('database')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadBookmarks() {
      try {
        const response = await fetch('/api/bookmarks', { cache: 'no-store' })
        if (response.status === 501) {
          if (mounted) {
            setStorageMode('local')
            setBookmarks(readLocalBookmarks())
          }
          return
        }
        if (!response.ok) throw new Error('Bookmarks could not be loaded')

        const payload = (await response.json()) as { bookmarks?: BookmarkRecord[] }
        if (mounted) {
          setStorageMode('database')
          setBookmarks(payload.bookmarks ?? [])
        }
      } catch (loadError) {
        if (mounted) {
          setStorageMode('local')
          setBookmarks(readLocalBookmarks())
          setError(loadError instanceof Error ? loadError.message : 'Bookmarks could not be loaded')
        }
      }
    }

    void loadBookmarks()
    return () => {
      mounted = false
    }
  }, [])

  const visibleBookmarks = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return bookmarks ?? []
    return (bookmarks ?? []).filter(bookmark =>
      `${bookmark.title} ${bookmark.url} ${bookmark.description ?? ''}`.toLowerCase().includes(needle)
    )
  }, [bookmarks, filter])

  function saveLocalBookmark(bookmark: BookmarkRecord) {
    const next = upsertBookmark(readLocalBookmarks(), bookmark)
    localStorage.setItem('bookmarks', JSON.stringify(next))
    setStorageMode('local')
    setBookmarks(next)
  }

  async function handleAdd() {
    const normalizedUrl = normalizeUrl(url.trim())
    if (!normalizedUrl) {
      setError('Enter a valid website address.')
      return
    }

    const fallback: BookmarkRecord = {
      id: `local-${Date.now()}`,
      title: title.trim() || bookmarkDomain(normalizedUrl),
      url: normalizedUrl,
      created_at: new Date().toISOString(),
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: fallback.title, url: normalizedUrl }),
      })

      if (response.status === 501) {
        saveLocalBookmark(fallback)
      } else if (response.ok) {
        const data = (await response.json()) as { bookmark?: BookmarkRecord }
        if (!data.bookmark) throw new Error('The bookmark response was incomplete')
        setStorageMode('database')
        setBookmarks(previous => upsertBookmark(previous ?? [], data.bookmark as BookmarkRecord))
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || 'Bookmark could not be saved')
      }

      setTitle('')
      setUrl('')
    } catch (saveError) {
      saveLocalBookmark(fallback)
      setError(
        `${saveError instanceof Error ? saveError.message : 'Server storage was unavailable'}. Saved in this browser instead.`
      )
      setTitle('')
      setUrl('')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(bookmark: BookmarkRecord) {
    setError(null)

    if (storageMode === 'local' || bookmark.id.startsWith('local-')) {
      const next = (bookmarks ?? []).filter(item => item.id !== bookmark.id)
      localStorage.setItem('bookmarks', JSON.stringify(next))
      setBookmarks(next)
      return
    }

    try {
      const response = await fetch(`/api/bookmarks?id=${encodeURIComponent(bookmark.id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Bookmark could not be deleted')
      setBookmarks(previous => (previous ?? []).filter(item => item.id !== bookmark.id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Bookmark could not be deleted')
    }
  }

  async function handleClearAll() {
    if (!(bookmarks?.length) || !window.confirm('Remove every saved bookmark?')) return
    setError(null)

    if (storageMode === 'local') {
      localStorage.removeItem('bookmarks')
      setBookmarks([])
      return
    }

    try {
      const response = await fetch('/api/bookmarks?all=true', { method: 'DELETE' })
      if (!response.ok) throw new Error('Bookmarks could not be cleared')
      setBookmarks([])
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Bookmarks could not be cleared')
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
                  <Bookmark className="h-3.5 w-3.5" /> Research library
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white/95">Bookmarks</h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/45">
                  Save useful sources, reopen them quickly, and keep the collection searchable.
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-xs text-white/45">
                {storageMode === 'database' ? <Database className="h-4 w-4 text-teal-200/70" /> : <HardDrive className="h-4 w-4 text-teal-200/70" />}
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/30">Storage</div>
                  <div className="mt-0.5 text-white/70">{storageMode === 'database' ? 'Persistent database' : 'This browser'}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-7">
            <div className="mb-5 grid gap-3 rounded-2xl border border-white/10 bg-black/10 p-4 sm:grid-cols-[1fr_1.35fr_auto]">
              <label className="relative">
                <span className="sr-only">Bookmark title</span>
                <Bookmark className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                <input
                  className="w-full rounded-xl border border-white/10 bg-white/[0.045] py-2.5 pl-10 pr-3 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-teal-200/25"
                  placeholder="Title (optional)"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                />
              </label>
              <label className="relative">
                <span className="sr-only">Bookmark URL</span>
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                <input
                  className="w-full rounded-xl border border-white/10 bg-white/[0.045] py-2.5 pl-10 pr-3 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-teal-200/25"
                  placeholder="Website address"
                  value={url}
                  onChange={event => setUrl(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') void handleAdd()
                  }}
                />
              </label>
              <button className="search-btn-glow justify-center" disabled={saving} onClick={() => void handleAdd()}>
                <Plus className="h-4 w-4" /> {saving ? 'Saving...' : 'Add'}
              </button>
            </div>

            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100/70">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span className="flex-1">{error}</span>
                <button aria-label="Dismiss message" onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button>
              </div>
            )}

            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative flex-1">
                <span className="sr-only">Filter bookmarks</span>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                <input
                  className="w-full rounded-xl border border-white/10 bg-white/[0.035] py-2.5 pl-10 pr-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-teal-200/25"
                  placeholder="Filter saved sources"
                  value={filter}
                  onChange={event => setFilter(event.target.value)}
                />
              </label>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-xs text-white/35">{visibleBookmarks.length} saved</span>
                <button className="glass-button !px-3 text-[11px]" disabled={!bookmarks?.length} onClick={() => void handleClearAll()}>
                  <Trash2 className="h-3.5 w-3.5" /> Clear all
                </button>
              </div>
            </div>

            {bookmarks === null ? (
              <div className="space-y-3" aria-label="Loading bookmarks">
                {[0, 1, 2].map(item => <div key={item} className="h-24 animate-pulse rounded-2xl border border-white/5 bg-white/[0.035]" />)}
              </div>
            ) : visibleBookmarks.length === 0 ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[22px] border border-dashed border-white/15 bg-white/[0.025] px-6 text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/[0.08] shadow-[0_0_45px_rgba(92,229,204,0.10)]">
                  <Bookmark className="h-7 w-7 text-teal-100/70" />
                </div>
                <h2 className="text-lg font-medium text-white/90">{filter ? 'No matching bookmarks' : 'No bookmarks yet'}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/45">
                  {filter ? 'Try a different title, domain, or keyword.' : 'Save a search result or add a website above to start your research library.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleBookmarks.map((bookmark, index) => (
                  <article
                    key={bookmark.id || bookmark.url}
                    className="result-card animate-in flex flex-col gap-4 sm:flex-row sm:items-center"
                    style={{ animationDelay: `${index * 35}ms` }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-white/30">
                        <span className="rounded-full border border-teal-200/15 bg-teal-200/[0.06] px-2 py-0.5 text-teal-100/65">{bookmarkDomain(bookmark.url)}</span>
                        <span>{formatDate(bookmark.created_at)}</span>
                      </div>
                      <a href={bookmark.url} target="_blank" rel="noreferrer" className="block truncate text-[15px] font-medium text-white/90 hover:text-teal-200">
                        {bookmark.title || bookmark.url}
                      </a>
                      {bookmark.description && <p className="mt-1 line-clamp-2 text-xs text-white/40">{bookmark.description}</p>}
                      <p className="mt-1 truncate text-[11px] text-white/25">{bookmark.url}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <a href={bookmark.url} target="_blank" rel="noreferrer" className="glass-button !px-3 text-[11px]">
                        <ExternalLink className="h-3.5 w-3.5" /> Open
                      </a>
                      <button className="glass-button !px-3 text-[11px]" onClick={() => void handleDelete(bookmark)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
