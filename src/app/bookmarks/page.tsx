"use client"

import { useEffect, useState } from 'react'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetch('/api/bookmarks')
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          if (res.status === 501) {
            const ls = localStorage.getItem('bookmarks')
            const parsed = ls ? JSON.parse(ls) : []
            if (mounted) setBookmarks(parsed)
            return
          }
          throw new Error((payload && payload.error) || 'Failed')
        }
        return res.json()
      })
      .then((data) => {
        if (!data) return
        if (data.bookmarks) setBookmarks(data.bookmarks)
      })
      .catch((err) => {
        console.warn('Bookmarks fetch failed, falling back to localStorage:', err)
        const ls = localStorage.getItem('bookmarks')
        const parsed = ls ? JSON.parse(ls) : []
        setBookmarks(parsed)
      })
      .finally(() => { if (mounted) setLoading(false) })

    return () => { mounted = false }
  }, [])

  const saveLocalBookmark = (b) => {
    const cur = localStorage.getItem('bookmarks')
    const arr = cur ? JSON.parse(cur) : []
    arr.unshift(b)
    localStorage.setItem('bookmarks', JSON.stringify(arr))
    setBookmarks(arr)
  }

  const handleAdd = async () => {
    if (!url) return
    // Try server first
    try {
      const res = await fetch('/api/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, url }) })
      if (res.ok) {
        const data = await res.json()
        if (data.bookmark) {
          setBookmarks(prev => [data.bookmark, ...(prev || [])])
          setTitle(''); setUrl('')
          return
        }
      }
    } catch (err) {
      console.warn('Server bookmark failed, saving locally', err)
    }
    const b = { id: Date.now().toString(), title: title || url, url, created_at: new Date().toISOString() }
    saveLocalBookmark(b)
    setTitle(''); setUrl('')
  }

  const handleDelete = async (b) => {
    // Try server delete
    try {
      if (b.id && !String(b.id).startsWith('local')) {
        const res = await fetch(`/api/bookmarks?id=${b.id}`, { method: 'DELETE' })
        if (res.ok) {
          setBookmarks(prev => (prev || []).filter(x => x.id !== b.id))
          return
        }
      }
    } catch (err) {
      console.warn('Server delete failed, falling back to local', err)
    }
    // Local delete
    const arr = (bookmarks || []).filter(x => x.id !== b.id)
    localStorage.setItem('bookmarks', JSON.stringify(arr))
    setBookmarks(arr)
  }

  if (loading && bookmarks === null) return <div className="p-6">Loading...</div>

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-4">Bookmarks</h1>
      <div className="mb-4 flex gap-2">
        <input className="flex-1 bg-transparent border border-white/10 px-3 py-2 rounded" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="flex-1 bg-transparent border border-white/10 px-3 py-2 rounded" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="glass-button" onClick={handleAdd}>Add</button>
      </div>

      {(!bookmarks || bookmarks.length === 0) ? (
        <div className="text-sm text-muted-foreground">No bookmarks yet.</div>
      ) : (
        <div className="space-y-3">
          {bookmarks.map(b => (
            <div key={b.id || b.url} className="p-3 rounded-lg bg-[#0f1724] border border-[#233242] flex items-center justify-between">
              <a href={b.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">{b.title || b.url}</a>
              <div className="flex items-center gap-2">
                <button className="glass-button" onClick={() => { window.open(b.url, '_blank') }}>Open</button>
                <button className="glass-button" onClick={() => handleDelete(b)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
