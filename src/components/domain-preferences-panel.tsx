'use client'

import { ArrowDown, ArrowUp, Ban, Globe2, Pin, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type DomainAction = 'raise' | 'lower' | 'pin' | 'block'

interface DomainPreferenceRecord {
  domain: string
  action: DomainAction
  updated_at?: string
}

const ACTION_DETAILS: Record<DomainAction, { label: string; description: string; icon: typeof Pin }> = {
  pin: { label: 'Pinned', description: 'Strongly preferred in future results', icon: Pin },
  raise: { label: 'Raised', description: 'Ranked higher when relevant', icon: ArrowUp },
  lower: { label: 'Lowered', description: 'Ranked lower when alternatives exist', icon: ArrowDown },
  block: { label: 'Blocked', description: 'Hidden from future results', icon: Ban },
}

export function DomainPreferencesPanel() {
  const [preferences, setPreferences] = useState<DomainPreferenceRecord[] | null>(null)
  const [removingDomain, setRemovingDomain] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    fetch('/api/domain-preferences?userId=default', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Domain preferences are unavailable')
        return (await response.json()) as { preferences?: DomainPreferenceRecord[] }
      })
      .then(data => {
        if (mounted) setPreferences(data.preferences ?? [])
      })
      .catch(loadError => {
        if (mounted) {
          setPreferences([])
          setError(loadError instanceof Error ? loadError.message : 'Domain preferences are unavailable')
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  const orderedPreferences = useMemo(
    () => [...(preferences ?? [])].sort((left, right) => {
      const actionOrder: Record<DomainAction, number> = { block: 0, pin: 1, raise: 2, lower: 3 }
      return actionOrder[left.action] - actionOrder[right.action] || left.domain.localeCompare(right.domain)
    }),
    [preferences]
  )

  async function resetDomain(domain: string) {
    setRemovingDomain(domain)
    setError(null)

    try {
      const params = new URLSearchParams({ userId: 'default', domain })
      const response = await fetch(`/api/domain-preferences?${params.toString()}`, { method: 'DELETE' })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Domain preference could not be reset')
      }
      setPreferences(current => (current ?? []).filter(preference => preference.domain !== domain))
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Domain preference could not be reset')
    } finally {
      setRemovingDomain(null)
    }
  }

  return (
    <section className="glass-surface rounded-[22px] p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <Globe2 className="mt-0.5 h-5 w-5 text-white/60" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-white/85">Personalized domains</h2>
          <p className="mt-0.5 text-xs text-white/35">
            Review and undo domain controls applied from search results.
          </p>
        </div>
        {preferences !== null && (
          <span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] text-white/35">
            {preferences.length} saved
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-[11px] text-amber-100/65">
          {error}
        </div>
      )}

      {preferences === null ? (
        <div className="space-y-2" aria-label="Loading domain preferences">
          {[0, 1].map(item => <div key={item} className="h-14 animate-pulse rounded-xl bg-white/[0.035]" />)}
        </div>
      ) : orderedPreferences.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] px-4 py-5 text-center">
          <p className="text-[12px] text-white/50">No domain preferences yet.</p>
          <p className="mt-1 text-[11px] text-white/30">Use the result menu to pin, raise, lower, or block a domain.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
          {orderedPreferences.map(preference => {
            const details = ACTION_DETAILS[preference.action]
            const Icon = details.icon
            const removing = removingDomain === preference.domain

            return (
              <div key={preference.domain} className="flex items-center gap-3 px-3.5 py-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-white/45">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-white/75">{preference.domain}</p>
                  <p className="mt-0.5 text-[10px] text-white/30">{details.label} · {details.description}</p>
                </div>
                <button
                  className="glass-button !px-3 text-[10px]"
                  disabled={Boolean(removingDomain)}
                  onClick={() => void resetDomain(preference.domain)}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {removing ? 'Resetting...' : 'Reset'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
