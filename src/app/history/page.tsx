"use client"

import { useEffect, useState } from 'react'

export default function HistoryPage() {
  const [runs, setRuns] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetch('/api/history')
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          if (res.status === 501) {
            // No DB configured — fallback to localStorage
            const ls = localStorage.getItem('search_history')
            const parsed = ls ? JSON.parse(ls) : []
            if (mounted) setRuns(parsed)
            return
          }
          throw new Error((payload && payload.error) || 'Failed')
        }
        return res.json()
      })
      .then((data) => {
        if (!data) return
        if (data.runs) setRuns(data.runs)
      })
      .catch((err) => {
        console.warn('History fetch failed, falling back to localStorage:', err)
        const ls = localStorage.getItem('search_history')
        const parsed = ls ? JSON.parse(ls) : []
        setRuns(parsed)
      })
      .finally(() => { if (mounted) setLoading(false) })

    return () => { mounted = false }
  }, [])

  if (loading && runs === null) return <div className="p-6">Loading...</div>

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-4">Search History</h1>
      {(!runs || runs.length === 0) ? (
        <div className="text-sm text-muted-foreground">No history available. Your recent searches are stored in localStorage if no database is configured.</div>
      ) : (
        <div className="space-y-3">
          {runs.map((r:any) => (
            <div key={r.id || r.timestamp || r.query} className="p-3 rounded-lg bg-[#0f1724] border border-[#233242]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">{new Date(r.created_at || r.timestamp || Date.now()).toLocaleString()}</div>
                  <div className="text-md font-medium">{r.query}</div>
                  <div className="text-xs text-white/40">Lens: {r.vertical || r.lens || 'web'}</div>
                </div>
                <div className="text-sm text-white/50">{r.result_count ?? '-' } results</div>
              </div>
              <div className="mt-2">
                <button className="glass-button" onClick={() => { window.location.href = '/'; localStorage.setItem('last_search', JSON.stringify({ query: r.query, lens: r.vertical || r.lens })) }}>
                  Re-run
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
