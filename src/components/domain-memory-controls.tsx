// ─── DOMAIN MEMORY CONTROLS ───
// UI component for raise/lower/pin/block domain actions

'use client'

import { useState } from 'react'
import { Button } from './ui/button'
import { Pin, ThumbsUp, ThumbsDown, Ban, X } from 'lucide-react'

type DomainAction = 'raise' | 'lower' | 'pin' | 'block'

interface DomainMemoryControlsProps {
  domain: string
  userId?: string
  onAction?: (action: DomainAction | null) => void
}

export function DomainMemoryControls({ domain, userId = 'default', onAction }: DomainMemoryControlsProps) {
  const [loading, setLoading] = useState(false)
  const [currentAction, setCurrentAction] = useState<DomainAction | null>(null)

  const handleAction = async (action: DomainAction) => {
    setLoading(true)
    try {
      const response = await fetch('/api/domain-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, domain, action }),
      })

      if (response.ok) {
        setCurrentAction(action)
        onAction?.(action)
      }
    } catch (error) {
      console.error('Failed to set domain preference:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/domain-preferences?userId=${userId}&domain=${encodeURIComponent(domain)}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setCurrentAction(null)
        onAction?.(null)
      }
    } catch (error) {
      console.error('Failed to remove domain preference:', error)
    } finally {
      setLoading(false)
    }
  }

  if (currentAction) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled>
          {currentAction === 'raise' && <ThumbsUp className="h-4 w-4 mr-1" />}
          {currentAction === 'lower' && <ThumbsDown className="h-4 w-4 mr-1" />}
          {currentAction === 'pin' && <Pin className="h-4 w-4 mr-1" />}
          {currentAction === 'block' && <Ban className="h-4 w-4 mr-1 text-red-600" />}
          <span className="text-xs capitalize">{currentAction}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={handleRemove} disabled={loading}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => handleAction('raise')} disabled={loading} title="Raise domain">
        <ThumbsUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => handleAction('lower')} disabled={loading} title="Lower domain">
        <ThumbsDown className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => handleAction('pin')} disabled={loading} title="Pin domain">
        <Pin className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => handleAction('block')} disabled={loading} title="Block domain" className="text-red-600">
        <Ban className="h-4 w-4" />
      </Button>
    </div>
  )
}
