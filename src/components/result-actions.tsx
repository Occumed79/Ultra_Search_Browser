'use client'

import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Bookmark as BookmarkIcon,
  MoreHorizontal,
  Pin,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from './ui/button'

interface ResultActionsProps {
  url: string
  resultId?: string
  domain?: string
}

let databaseCapabilityRequest: Promise<boolean> | null = null

function databaseActionsAvailable() {
  if (!databaseCapabilityRequest) {
    databaseCapabilityRequest = fetch('/api/capabilities', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return false
        const data = (await response.json()) as { database?: { configured?: boolean } }
        return data.database?.configured === true
      })
      .catch(() => false)
  }
  return databaseCapabilityRequest
}

function saveLocalBookmark(url: string, domain?: string) {
  const stored = localStorage.getItem('bookmarks')
  const parsed: unknown = stored ? JSON.parse(stored) : []
  const current = Array.isArray(parsed) ? parsed as Array<{ id: string; title: string; url: string; created_at: string }> : []
  const bookmark = {
    id: `local-${Date.now()}`,
    title: domain || url,
    url,
    created_at: new Date().toISOString(),
  }
  const next = [bookmark, ...current.filter(item => item.url !== url)]
  localStorage.setItem('bookmarks', JSON.stringify(next))
}

export function ResultActions({ url, resultId, domain }: ResultActionsProps) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [persistentActionsEnabled, setPersistentActionsEnabled] = useState(false)

  useEffect(() => {
    let mounted = true
    void databaseActionsAvailable().then(enabled => {
      if (mounted) setPersistentActionsEnabled(enabled)
    })
    return () => {
      mounted = false
    }
  }, [])

  function showMessage(value: string) {
    setMessage(value)
    window.setTimeout(() => setMessage(null), 1800)
  }

  async function sendFeedback(feedbackType: string) {
    if (!persistentActionsEnabled) return
    setLoading(true)
    setMessage(null)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultId, url, feedbackType }),
      })
      showMessage(response.ok ? 'Saved' : 'Failed')
    } catch {
      showMessage('Failed')
    } finally {
      setLoading(false)
    }
  }

  async function setDomain(action: string) {
    if (!persistentActionsEnabled) return
    setLoading(true)
    setMessage(null)
    try {
      const response = await fetch('/api/domain-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default', domain: domain || new URL(url).hostname, action }),
      })
      showMessage(response.ok ? 'Saved' : 'Failed')
    } catch {
      showMessage('Failed')
    } finally {
      setLoading(false)
    }
  }

  async function confirmBlock() {
    setConfirmOpen(false)
    await setDomain('block')
  }

  async function saveBookmark() {
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: domain || url, url }),
      })

      if (response.ok) {
        showMessage('Bookmarked')
        return
      }

      if (response.status !== 501) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Bookmark could not be saved')
      }
    } catch {
      // The bookmark still remains useful when persistent storage is temporarily unavailable.
    } finally {
      try {
        if (!persistentActionsEnabled) {
          saveLocalBookmark(url, domain)
          showMessage('Saved locally')
        } else if (!message) {
          // A database request may fail even when capability detection previously succeeded.
          saveLocalBookmark(url, domain)
          showMessage('Saved locally')
        }
      } catch {
        showMessage('Failed')
      }
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {message && <span className="mr-1 text-[10px] text-white/35">{message}</span>}

      <Button variant="ghost" size="sm" onClick={saveBookmark} disabled={loading} title="Save bookmark" aria-label="Save bookmark">
        <BookmarkIcon className="h-4 w-4" />
      </Button>

      {persistentActionsEnabled && (
        <>
          <Button variant="ghost" size="sm" onClick={() => void sendFeedback('good_result')} disabled={loading} title="Useful result" aria-label="Mark result useful">
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void sendFeedback('bad_result')} disabled={loading} title="Not useful" aria-label="Mark result not useful">
            <ThumbsDown className="h-4 w-4" />
          </Button>

          <details className="group relative">
            <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80 [&::-webkit-details-marker]:hidden" title="Domain controls" aria-label="Open domain controls">
              <MoreHorizontal className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 top-9 z-30 w-40 overflow-hidden rounded-xl border border-white/10 bg-[#0b1522]/95 p-1.5 shadow-2xl backdrop-blur-xl">
              <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-white/65 hover:bg-white/[0.06]" disabled={loading} onClick={() => void setDomain('pin')}>
                <Pin className="h-3.5 w-3.5" /> Pin domain
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-white/65 hover:bg-white/[0.06]" disabled={loading} onClick={() => void setDomain('raise')}>
                <ArrowUp className="h-3.5 w-3.5" /> Raise domain
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-white/65 hover:bg-white/[0.06]" disabled={loading} onClick={() => void setDomain('lower')}>
                <ArrowDown className="h-3.5 w-3.5" /> Lower domain
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-red-200/65 hover:bg-red-400/[0.07]" disabled={loading} onClick={() => setConfirmOpen(true)}>
                <Ban className="h-3.5 w-3.5" /> Block domain
              </button>
            </div>
          </details>
        </>
      )}

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90%] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0b1522] p-5 shadow-2xl">
            <Dialog.Title className="text-lg font-medium text-white/90">Block domain</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-white/45">
              Hide future results from {domain || 'this domain'} until the preference is changed.
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => void confirmBlock()}>Block</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
