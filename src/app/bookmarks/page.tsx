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
