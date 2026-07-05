"use client"

import { useState } from 'react'
import { Button } from './ui/button'
import { ThumbsUp, ThumbsDown, Pin, ArrowUp, ArrowDown, Ban } from 'lucide-react'

interface ResultActionsProps {
  url: string
  resultId?: string
  domain?: string
}

export function ResultActions({ url, resultId, domain }: ResultActionsProps) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

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
      <Button variant="ghost" size="sm" onClick={() => setDomain('block')} disabled={loading} title="Block domain">
        <Ban className="h-4 w-4 text-red-600" />
      </Button>

      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  )
}
