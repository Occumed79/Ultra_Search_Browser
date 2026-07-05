// ... existing imports remain at top

import { useState, useMemo, useEffect, useRef } from "react";
import { ResultActions } from '@/components/result-actions'

// inside SearchResultCard component
function SearchResultCard({ result, index }) {
  const domain = (() => {
    try { return new URL(result.url).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();

  const sourceStyle = SOURCE_COLORS[result.source] || "bg-white/5 text-white/40 border-white/10";

  // Domain preference state
  const [domainPref, setDomainPref] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetch(`/api/domain-preferences?userId=default`).then(async (res) => {
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      if (!data) return
      const prefs = data.preferences || []
      const hostname = domain.toLowerCase().replace(/^www\./, '')
      const match = prefs.find((p:any) => p.domain === hostname)
      if (mounted) setDomainPref(match?.action || null)
    }).catch(() => {})

    return () => { mounted = false }
  }, [domain])

  const prefBadge = domainPref ? (
    <span className={
      'text-[10px] px-2 py-0.5 rounded-full font-medium ' +
      (domainPref === 'pin' ? 'bg-teal-500/10 text-teal-300 border-teal-500/30' :
       domainPref === 'raise' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' :
       domainPref === 'lower' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' :
       domainPref === 'block' ? 'bg-red-500/10 text-red-300 border-red-500/30' : 'bg-white/5 text-white/40 border-white/10')
    }>
      {domainPref}
    </span>
  ) : null

  return (
    <div className="result-card animate-in" style={{ animationDelay: (index * 40) + 'ms' }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <img
            src={'https://www.google.com/s2/favicons?domain=' + domain + '&sz=32'}
            alt=""
            className="w-5 h-5 rounded opacity-60"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={'text-[10px] px-2 py-0.5 rounded-full border font-medium ' + sourceStyle}>
              {result.source}
            </span>
            <span className="text-[10px] text-white/30 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              #{result.rank || index + 1}
            </span>
            <div className="ml-2">{prefBadge}</div>
          </div>
          <a href={result.url} target="_blank" rel="noopener noreferrer" className="block group/link">
            <h3 className="text-[14px] font-medium text-white/85 hover:text-teal-300/90 transition-colors line-clamp-1">
              {result.title}
            </h3>
            <p className="text-[11px] text-teal-400/50 line-clamp-1 mt-0.5">{result.url}</p>
          </a>
          {result.description && (
            <p className="text-[13px] text-white/40 mt-1.5 line-clamp-2">{result.description}</p>
          )}
          {result.intelligence && (
            <div className="mt-2.5 p-2.5 bg-white/3 rounded-lg border border-white/5">
              {isProcurementIntelligence(result.intelligence) && <ProcurementCard intelligence={result.intelligence} />}
              {isProviderIntelligence(result.intelligence) && <ProviderCard intelligence={result.intelligence} />}
              {isPricingIntelligence(result.intelligence) && <PricingCard intelligence={result.intelligence} />}
              {isLegalIntelligence(result.intelligence) && <LegalCard intelligence={result.intelligence} />}
              {isMedicalIntelligence(result.intelligence) && <MedicalCard intelligence={result.intelligence} />}
              {isAcademicIntelligence(result.intelligence) && <AcademicCard intelligence={result.intelligence} />}
              {isFinancialIntelligence(result.intelligence) && <FinancialCard intelligence={result.intelligence} />}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <a href={result.url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-[11px] text-teal-300/60 hover:text-teal-300/90 transition-colors">
              <ExternalLink className="h-3 w-3" />
              Visit
            </a>
            <span className="text-[11px] text-white/25">{domain}</span>

            {/* Result actions (feedback, domain prefs, bookmark) */}
            <div className="ml-auto">
              <ResultActions url={result.url} resultId={result.id || undefined} domain={domain} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
