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
  feedbackContext?: Record<string, unknown>
}

const POSITIVE_ACTIONS = [
  ['pursue', 'Pursue'],
  ['strong_match', 'Strong match'],
  ['possible_match', 'Possible match'],
  ['subcontract_only', 'Subcontract only'],
] as const

const REJECTION_ACTIONS = [
  ['wrong_service', 'Wrong service'],
  ['treatment_contract', 'Treatment contract'],
  ['staffing_contract', 'Staffing contract'],
  ['equipment_purchase', 'Equipment purchase'],
  ['wrong_geography', 'Wrong geography'],
  ['mandatory_disqualifier', 'Mandatory disqualifier'],
  ['too_little_time', 'Too little time'],
  ['expired', 'Expired'],
  ['duplicate', 'Duplicate'],
  ['not_solicitation', 'Not a solicitation'],
  ['decline', 'Decline'],
] as const

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

export function ResultActions({ url, resultId, domain, feedbackContext }: ResultActionsProps) {
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
        body: JSON.stringify({
          resultId,
          url,
          feedbackType,
          notes: feedbackContext ? JSON.stringify(feedbackContext) : undefined,
        }),
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
    let persisted = false

    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: domain || url, url }),
      })

      if (response.ok) {
        persisted = true
        showMessage('Bookmarked')
      } else if (response.status !== 501) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Bookmark could not be saved')
      }
    } catch {
      // Fall through to browser storage so the action still succeeds.
    } finally {
      if (!persisted) {
        try {
          saveLocalBookmark(url, domain)
          showMessage('Saved locally')
        } catch {
          showMessage('Failed')
        }
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
            <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80 [&::-webkit-details-marker]:hidden" title="Opportunity actions" aria-label="Open opportunity actions">
              <MoreHorizontal className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 top-9 z-30 max-h-[420px] w-52 overflow-y-auto rounded-xl border border-white/10 bg-[#0b1522]/98 p-1.5 shadow-2xl backdrop-blur-xl">
              <p className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-white/25">Pursuit decision</p>
              {POSITIVE_ACTIONS.map(([value, label]) => (
                <button key={value} className="flex w-full rounded-lg px-2.5 py-2 text-left text-[11px] text-emerald-100/70 hover:bg-emerald-300/[0.07]" disabled={loading} onClick={() => void sendFeedback(value)}>
                  {label}
                </button>
              ))}
              <p className="mt-1 border-t border-white/[0.06] px-2.5 pb-1 pt-2 text-[9px] uppercase tracking-wider text-white/25">Reject or lower</p>
              {REJECTION_ACTIONS.map(([value, label]) => (
                <button key={value} className="flex w-full rounded-lg px-2.5 py-2 text-left text-[11px] text-amber-100/60 hover:bg-amber-300/[0.06]" disabled={loading} onClick={() => void sendFeedback(value)}>
                  {label}
                </button>
              ))}
              <p className="mt-1 border-t border-white/[0.06] px-2.5 pb-1 pt-2 text-[9px] uppercase tracking-wider text-white/25">Source controls</p>
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
