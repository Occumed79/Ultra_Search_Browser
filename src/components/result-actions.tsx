"use client"

import { useState } from 'react'
import { Button } from './ui/button'
import { ThumbsUp, ThumbsDown, Pin, ArrowUp, ArrowDown, Ban, Bookmark as BookmarkIcon } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'

interface ResultActionsProps {
  url: string
  resultId?: string
  domain?: string
}

export function ResultActions({ url, resultId, domain }: ResultActionsProps) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function sendFeedback(feedbackType: string, notes?: string) {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultId, url, feedbackType, notes }),
      })
      if (res.ok) {
        setMessage('Saved')
      } else {
        setMessage('Failed')
      }
    } catch (err) {
      console.error('Feedback failed', err)
      setMessage('Error')
    } finally {
      setLoading(false)
      setTimeout(() => setMessage(null), 2000)
    }
  }

  async function setDomain(action: string) {
    setLoading(true)
    try {
      const res = await fetch('/api/domain-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default', domain: domain || new URL(url).hostname, action }),
      })
      if (res.ok) setMessage('Saved')
      else setMessage('Failed')
    } catch (err) {
      console.error('Domain action failed', err)
      setMessage('Error')
    } finally {
      setLoading(false)
      setTimeout(() => setMessage(null), 2000)
    }
  }

  async function handleBlock() {
    // open confirmation dialog
    setConfirmOpen(true)
  }

  async function confirmBlock() {
    setConfirmOpen(false)
    await setDomain('block')
  }

  async function saveBookmark() {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: undefined, url }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.bookmark) {
          setMessage('Bookmarked')
          setLoading(false)
          setTimeout(() => setMessage(null), 2000)
          return
        }
      }
    } catch (err) {
      console.warn('Server bookmark failed, saving locally', err)
    }

    // Fallback to localStorage
    try {
      const cur = localStorage.getItem('bookmarks')
      const arr = cur ? JSON.parse(cur) : []
      arr.unshift({ id: 'local-' + Date.now(), title: url, url, created_at: new Date().toISOString() })
      localStorage.setItem('bookmarks', JSON.stringify(arr))
      setMessage('Saved')
    } catch (err) {
      console.error('Local bookmark failed', err)
      setMessage('Error')
    } finally {
      setLoading(false)
      setTimeout(() => setMessage(null), 2000)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => sendFeedback('good_result')} disabled={loading} title="Mark useful">
        <ThumbsUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => sendFeedback('bad_result')} disabled={loading} title="Mark not useful">
        <ThumbsDown className="h-4 w-4" />
      </Button>

      <Button variant="ghost" size="sm" onClick={() => setDomain('pin')} disabled={loading} title="Pin domain">
        <Pin className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDomain('raise')} disabled={loading} title="Boost domain">
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDomain('lower')} disabled={loading} title="Lower domain">
        <ArrowDown className="h-4 w-4" />
      </Button>

      <Button variant="ghost" size="sm" onClick={handleBlock} disabled={loading} title="Block domain">
        <Ban className="h-4 w-4 text-red-600" />
      </Button>

      <Button variant="ghost" size="sm" onClick={saveBookmark} disabled={loading} title="Save bookmark">
        <BookmarkIcon className="h-4 w-4" />
      </Button>

      {message && <span className="text-xs text-muted-foreground">{message}</span>}

      {/* Confirmation dialog for block action */}
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60" />
          <Dialog.Content className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md rounded-lg bg-[#0f1724] border border-[#233242] p-4">
            <Dialog.Title className="text-lg font-medium mb-2">Block domain</Dialog.Title>
            <Dialog.Description className="text-sm text-white/60 mb-4">Block all results from this domain. This will hide them from your future searches.</Dialog.Description>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmBlock}>Block</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
