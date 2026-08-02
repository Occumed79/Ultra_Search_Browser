'use client'

import { ChevronDown, Tag } from 'lucide-react'
import { useState } from 'react'
import { buyerLanguageTermsForQuery } from '../lib/occumed-capability-matching'

export function BuyerTermsDropdown({ query, onTermSelect }: { query: string; onTermSelect: (term: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const buyerTerms = buyerLanguageTermsForQuery(query, 12)

  if (buyerTerms.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60 hover:bg-white/10 hover:text-white/80 transition-colors"
      >
        <Tag className="h-3.5 w-3.5" />
        <span>Buyer Terms</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-white/10 bg-black/95 backdrop-blur-sm shadow-2xl">
          <div className="p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-white/40">Terms used by buyers</p>
            <div className="flex flex-wrap gap-1.5">
              {buyerTerms.map((term, index) => (
                <button
                  key={index}
                  onClick={() => {
                    onTermSelect(term)
                    setIsOpen(false)
                  }}
                  className="rounded-md border border-teal-300/10 bg-teal-300/[0.04] px-2 py-1 text-[10px] text-teal-100/60 hover:border-teal-300/20 hover:bg-teal-300/[0.08] hover:text-teal-100/80 transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
