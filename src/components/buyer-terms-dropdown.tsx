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
    }
  }, [])

  if (!portalHost) return null

  return createPortal(
    <section
      className="search-pill mt-3 flex min-h-[60px] w-full items-center gap-3 overflow-hidden px-5 py-3"
      aria-label="Buyer search terms"
    >
      <div className="flex flex-shrink-0 items-center gap-2 text-[11px] font-medium text-teal-100/70">
        <Tag className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="hidden sm:inline">Buyer search terms</span>
        <span className="sm:hidden">Terms</span>
      </div>

      {buyerTerms.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {buyerTerms.map(term => (
            <button
              key={term}
              type="button"
              onClick={() => onTermSelect(term)}
              className="flex-shrink-0 rounded-full border border-teal-300/10 bg-teal-300/[0.04] px-2.5 py-1 text-[10px] text-teal-100/60 transition-colors hover:border-teal-300/25 hover:bg-teal-300/[0.09] hover:text-teal-100/90"
            >
              {term}
            </button>
          ))}
        </div>
      ) : (
        <p className="min-w-0 flex-1 truncate text-[11px] text-white/35">
          Type a search query and the buyer-language terms Ultra Search is using will appear here.
        </p>
      )}
    </section>,
    portalHost
  )
}
