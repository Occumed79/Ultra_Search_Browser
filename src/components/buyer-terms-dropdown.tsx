'use client'

import { Tag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { buyerLanguageTermsForQuery } from '../lib/occumed-capability-matching'

export function BuyerTermsDropdown({ query, onTermSelect }: { query: string; onTermSelect: (term: string) => void }) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const buyerTerms = buyerLanguageTermsForQuery(query, 12)

  useEffect(() => {
    const searchInput = document.querySelector<HTMLInputElement>('.search-pill input')
    const searchBar = searchInput?.closest<HTMLElement>('.search-pill')
    if (!searchBar?.parentElement) return

    const host = document.createElement('div')
    host.dataset.buyerTermsHost = 'true'
    host.className = 'w-full'
    searchBar.insertAdjacentElement('afterend', host)
    setPortalHost(host)

    return () => {
      host.remove()
      setPortalHost(null)
    }
  }, [])

  if (!portalHost) return null

  return createPortal(
    <section className="search-pill mt-3 w-full px-5 py-3" aria-label="Buyer search terms">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-[145px] items-center gap-2 pt-0.5 text-[11px] font-medium text-teal-100/70">
          <Tag className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Buyer search terms</span>
        </div>

        {buyerTerms.length > 0 ? (
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {buyerTerms.map(term => (
              <button
                key={term}
                type="button"
                onClick={() => onTermSelect(term)}
                className="rounded-full border border-teal-300/10 bg-teal-300/[0.04] px-2.5 py-1 text-[10px] text-teal-100/60 transition-colors hover:border-teal-300/25 hover:bg-teal-300/[0.09] hover:text-teal-100/90"
              >
                {term}
              </button>
            ))}
          </div>
        ) : (
          <p className="flex-1 pt-0.5 text-[11px] text-white/35">
            Type a search query and the buyer-language terms Ultra Search is using will appear here.
          </p>
        )}
      </div>
    </section>,
    portalHost
  )
}
