// @ts-nocheck
"use client";

import {
  Search, ExternalLink, Clock, Filter, X, Download, Sparkles, TrendingUp,
  Calendar, DollarSign, MapPin, Phone, Mail, CheckCircle, AlertTriangle,
  Clock as ClockIcon, Bookmark, Settings, Command, ChevronRight
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { useSearch } from "../hooks/use-search";
import {
  type SearchLens, type ScrapedResult,
  type ProcurementIntelligence, type ProviderIntelligence, type PricingIntelligence,
  type LegalIntelligence, type MedicalIntelligence, type AcademicIntelligence, type FinancialIntelligence
} from "../types/search";
import { useState, useMemo, useEffect, useRef } from "react";

const LENSES = [
  { id: "web", label: "Web" },
  { id: "pdf", label: "PDF" },
  { id: "government", label: "Gov" },
  { id: "procurement", label: "RFP" },
  { id: "pricing", label: "Pricing" },
  { id: "provider", label: "Provider" },
  { id: "technical", label: "Tech" },
  { id: "news", label: "News" },
  { id: "legal", label: "Legal" },
  { id: "medical", label: "Medical" },
  { id: "academic", label: "Academic" },
  { id: "financial", label: "Financial" },
];

const SOURCE_COLORS = {
  Google: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  Bing: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  DuckDuckGo: "bg-orange-500/10 text-orange-300 border-orange-500/30",
};

function OccuMedLogo({ className = "" }) {
  return (
    <svg viewBox="0 0 200 60" className={className} fill="none">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(220,235,255,0.95)" />
          <stop offset="100%" stopColor="rgba(180,210,240,0.7)" />
        </linearGradient>
        <filter id="logoGlow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d="M8 48 L8 12 C8 8 14 8 16 12 L24 36 L32 12 C34 8 40 8 40 12 L40 48"
            stroke="url(#logoGrad)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
            fill="none" filter="url(#logoGlow)" />
      <text x="52" y="38" fill="url(#logoGrad)" fontSize="22" fontWeight="600"
            fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif"
            letterSpacing="1.5" filter="url(#logoGlow)">
        OCCU-MED
      </text>
    </svg>
  );
}

export default function Home() {
  const {
    query, setQuery, lens, setLens,
    intelligence, scrapedResults, isLoading, error, suggestions,
    hasSearched, searchTime, performSearch,
  } = useSearch();

  const [sortBy, setSortBy] = useState('score');
  const [filterSource, setFilterSource] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sources = useMemo(() => {
    const uniqueSources = new Set(scrapedResults.map(r => r.source));
    return Array.from(uniqueSources);
  }, [scrapedResults]);

  const filteredResults = useMemo(() => {
    let results = [...scrapedResults];
    if (filterSource) results = results.filter(r => r.source === filterSource);
    results.sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'rank') return a.rank - b.rank;
      if (sortBy === 'source') return a.source.localeCompare(b.source);
      return 0;
    });
    return results;
  }, [scrapedResults, sortBy, filterSource]);

  const exportResults = (format) => {
    const safeQuery = query.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 50);
    const timestamp = new Date().toISOString();
    if (format === 'json') {
      const data = JSON.stringify({
        metadata: { query, lens, timestamp, resultCount: filteredResults.length },
        results: filteredResults,
      }, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'search-results-' + safeQuery + '-' + timestamp + '.json';
      a.click(); URL.revokeObjectURL(url);
    } else if (format === 'csv') {
      const headers = ['Title', 'URL', 'Description', 'Source', 'Score', 'Rank'];
      const rows = filteredResults.map(r => [
        '"' + (r.title || '').replace(/"/g, '""') + '"',
        '"' + r.url + '"', '"' + (r.description || '').replace(/"/g, '""') + '"',
        '"' + r.source + '"', String(r.score ?? 0), String(r.rank ?? 0),
      ]);
      const csv = ['"Metadata","Query: ' + query + '","Lens: ' + lens + '","Timestamp: ' + timestamp + '","Results: ' + filteredResults.length + '"',
        headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'search-results-' + safeQuery + '-' + timestamp + '.csv';
      a.click(); URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="min-h-screen relative">
      <div className="liquid-bg">
        <div className="aurora-1" />
        <div className="aurora-2" />
        <div className="aurora-3" />
        <div className="glass-bubble bubble-1" />
        <div className="glass-bubble bubble-2" />
        <div className="glass-bubble bubble-3" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <a href="/" className="logo-glow">
          <OccuMedLogo className="h-9 w-auto" />
        </a>
        <div className="flex items-center gap-2">
          <button className="glass-button" onClick={() => window.location.href='/history'}>
            <ClockIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">History</span>
          </button>
          <button className="glass-button" onClick={() => window.location.href='/bookmarks'}>
            <Bookmark className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Bookmarks</span>
          </button>
          <button className="glass-button" onClick={() => window.location.href='/settings'}>
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-col items-center px-4"
            style={{ marginTop: hasSearched ? '16px' : '12vh' }}>

        <div className="w-full max-w-2xl">
          <div className="search-pill flex items-center gap-3 px-5 py-3">
            <Search className="w-5 h-5 text-white/40 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search anything..."
              className="flex-1 bg-transparent border-none outline-none text-[15px] text-white/90 placeholder:text-white/35"
              onKeyDown={(e) => { if (e.key === 'Enter') performSearch(); }}
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/40 font-mono">
                <Command className="w-3 h-3" />K
              </kbd>
              <button onClick={performSearch} disabled={isLoading} className="search-btn-glow">
                {isLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setLensOpen(!lensOpen)}
                className={'w-10 h-10 rounded-full flex items-center justify-center transition-all ' +
                  (lensOpen
                    ? 'bg-white/10 border border-white/20 text-white/90'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:text-white/80')
                }
                title="Search lenses"
              >
                <ChevronRight className={'w-4 h-4 transition-transform ' + (lensOpen ? 'rotate-90' : '')} />
              </button>
              {lensOpen && (
                <div className="absolute top-12 left-0 lens-cluster animate-in" style={{ minWidth: '280px' }}>
                  {LENSES.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => { setLens(l.id); setLensOpen(false); }}
                      className={'lens-pill ' + (lens === l.id ? 'active' : '')}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!lensOpen && (
              <span className="text-[13px] text-white/40">
                Lens: <span className="text-white/70 font-medium">{LENSES.find(l => l.id === lens)?.label}</span>
              </span>
            )}
          </div>
        </div>

        {hasSearched && (
          <div className="w-full max-w-2xl mt-6 pb-16 animate-in">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">
                  {filteredResults.length} results
                  {filterSource && ' (from ' + scrapedResults.length + ')'}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 text-white/50 uppercase tracking-wider">
                  {lens}
                </span>
                {filterSource && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50 flex items-center gap-1">
                    {filterSource}
                    <button onClick={() => setFilterSource(null)} className="hover:text-white/80">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/30">{searchTime.toFixed(0)}ms</span>
                <button onClick={() => setShowFilters(!showFilters)} className="glass-button text-[11px] py-1.5 px-2.5">
                  <Filter className="w-3 h-3 mr-1" />
                  Filters
                </button>
              </div>
            </div>

            {showFilters && (
              <div className="glass-surface rounded-xl p-3 mb-4 animate-in">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-white/40">Sort:</span>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                      className="text-[11px] bg-white/5 border border-white/10 rounded-md px-2 py-1 text-white/70 outline-none">
                      <option value="score">Score</option>
                      <option value="rank">Rank</option>
                      <option value="source">Source</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-white/40">Source:</span>
                    <select value={filterSource || ''} onChange={(e) => setFilterSource(e.target.value || null)}
                      className="text-[11px] bg-white/5 border border-white/10 rounded-md px-2 py-1 text-white/70 outline-none">
                      <option value="">All</option>
                      {sources.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button onClick={() => exportResults('json')} className="glass-button text-[11px] py-1.5 px-2.5">
                      <Download className="w-3 h-3 mr-1" /> JSON
                    </button>
                    <button onClick={() => exportResults('csv')} className="glass-button text-[11px] py-1.5 px-2.5">
                      <Download className="w-3 h-3 mr-1" /> CSV
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 rounded-xl border border-red-400/30 bg-red-400/5 text-red-300 text-sm">
                <p className="font-medium">Error</p>
                <p className="text-xs mt-1 opacity-80">{error}</p>
              </div>
            )}

            {intelligence && (
              <div className="glass-surface rounded-xl p-4 mb-5 animate-in">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-teal-300/80" />
                  <h3 className="text-[13px] font-medium text-white/80">Summary</h3>
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-white/10 text-white/40">
                    {intelligence.confidence}% confidence
                  </span>
                </div>
                <p className="text-[13px] text-white/50 leading-relaxed">
                  {intelligence.summary || 'Results for "' + intelligence.query + '" using ' + intelligence.lens + ' lens.'}
                </p>
                {intelligence.queryExpansions.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Related
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {intelligence.queryExpansions.map((q, i) => (
                        <button key={i} onClick={() => { setQuery(q); performSearch(); }}
                          className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white/70 transition-colors">
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {intelligence.signals.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {intelligence.signals.map((sig, i) => (
                      <span key={i}
                        className={'text-[10px] px-2 py-0.5 rounded-full border ' + (sig.score > 0
                          ? 'bg-emerald-500/10 text-emerald-300/80 border-emerald-500/20'
                          : 'bg-red-500/10 text-red-300/80 border-red-500/20')}
                        title={sig.description}
                      >
                        {sig.name} {sig.score > 0 ? '+' : ''}{sig.score}
                      </span>
                    ))}
                  </div>
                )}
                {intelligence.note && (
                  <div className="mt-3 bg-amber-400/5 border border-amber-400/20 rounded-lg p-2.5 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70" />
                    <p className="text-[11px] text-amber-300/70">{intelligence.note}</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              {filteredResults.map((result, index) => (
                <SearchResultCard key={result.url + index} result={result} index={index} />
              ))}
            </div>

            {filteredResults.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Search className="h-8 w-8 text-white/20 mx-auto mb-3" />
                <p className="text-sm text-white/40">No results found</p>
                <p className="text-xs text-white/25 mt-1">Try a different query</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SearchResultCard({ result, index }) {
  const domain = (() => {
    try { return new URL(result.url).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();

  const sourceStyle = SOURCE_COLORS[result.source] || "bg-white/5 text-white/40 border-white/10";

  return (
    <div className="result-card animate-in" style={{ animationDelay: (index * 40) + 'ms' }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <img
            src={'https://www.google.com/s2/favicons?domain=' + domain + '&sz=32'}
            alt=""
            className="w-5 h-5 rounded opacity-60"
            onError={(e) => { e.target.style.display = 'none'; }}
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
          </div>
        </div>
      </div>
    </div>
  );
}

function isProcurementIntelligence(obj) { return obj && 'opportunity_type' in obj && 'organization' in obj; }
function isProviderIntelligence(obj) { return obj && 'provider_name' in obj && 'services_offered' in obj; }
function isPricingIntelligence(obj) { return obj && 'service' in obj && 'price_cash' in obj; }
function isLegalIntelligence(obj) { return obj && 'legal_type' in obj; }
function isMedicalIntelligence(obj) { return obj && 'medical_type' in obj; }
function isAcademicIntelligence(obj) { return obj && 'academic_type' in obj; }
function isFinancialIntelligence(obj) { return obj && 'financial_type' in obj; }

function ProcurementCard({ intelligence }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] border-white/10 text-white/50">{intelligence.opportunity_type}</Badge>
        {intelligence.status && (
          <Badge variant={intelligence.status === 'open' ? 'default' : 'secondary'} className="text-[10px]">{intelligence.status}</Badge>
        )}
      </div>
      <div className="text-[13px] font-medium text-white/70">{intelligence.organization}</div>
      <div className="text-[11px] text-white/35">{intelligence.service}</div>
      {intelligence.due_date && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <Calendar className="h-3 w-3" /> Due: {intelligence.due_date}
        </div>
      )}
      {intelligence.monetary_value && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <DollarSign className="h-3 w-3" /> {intelligence.monetary_value}
        </div>
      )}
      {intelligence.procurement_email && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <Mail className="h-3 w-3" /> {intelligence.procurement_email}
        </div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-white/30">
        <CheckCircle className="h-3 w-3" /> Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  );
}

function ProviderCard({ intelligence }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium text-white/70">{intelligence.provider_name}</div>
      {intelligence.address && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <MapPin className="h-3 w-3" /> {intelligence.address}
        </div>
      )}
      {intelligence.provider_phone && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <Phone className="h-3 w-3" /> {intelligence.provider_phone}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {intelligence.services_offered.map((service, i) => (
          <Badge key={i} variant="secondary" className="text-[10px]">{service}</Badge>
        ))}
      </div>
      {intelligence.credentials && intelligence.credentials.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {intelligence.credentials.map((cred, i) => (
            <Badge key={i} variant="outline" className="text-[10px]">{cred}</Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-white/30">
        <CheckCircle className="h-3 w-3" /> Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  );
}

function PricingCard({ intelligence }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium text-white/70">{intelligence.provider_name}</div>
      <div className="text-[11px] text-white/35">{intelligence.service}</div>
      {intelligence.price_cash && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <DollarSign className="h-3 w-3" /> Cash: {intelligence.price_cash}
        </div>
      )}
      {intelligence.price_employer && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <DollarSign className="h-3 w-3" /> Employer: {intelligence.price_employer}
        </div>
      )}
      {intelligence.price_range && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <DollarSign className="h-3 w-3" /> Range: {intelligence.price_range}
        </div>
      )}
      {intelligence.payment_types && intelligence.payment_types.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {intelligence.payment_types.map((type, i) => (
            <Badge key={i} variant="secondary" className="text-[10px]">{type}</Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-white/30">
        <CheckCircle className="h-3 w-3" /> Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  );
}

function LegalCard({ intelligence }) {
  return (
    <div className="space-y-1.5">
      {intelligence.legal_type && (
        <Badge variant="outline" className="text-[10px]">{intelligence.legal_type}</Badge>
      )}
      {intelligence.case_name && (
        <div className="text-[13px] font-medium text-white/70">{intelligence.case_name}</div>
      )}
      {intelligence.court && (
        <div className="text-[11px] text-white/35">Court: {intelligence.court}</div>
      )}
      {intelligence.citation && (
        <div className="text-[11px] text-white/35">Citation: {intelligence.citation}</div>
      )}
      {intelligence.decision_date && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <Calendar className="h-3 w-3" /> {intelligence.decision_date}
        </div>
      )}
      {intelligence.statute_name && (
        <div className="text-[11px] text-white/35">Statute: {intelligence.statute_name}</div>
      )}
      {intelligence.regulation_number && (
        <div className="text-[11px] text-white/35">Regulation: {intelligence.regulation_number}</div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-white/30">
        <CheckCircle className="h-3 w-3" /> Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  );
}

function MedicalCard({ intelligence }) {
  return (
    <div className="space-y-1.5">
      {intelligence.medical_type && (
        <Badge variant="outline" className="text-[10px]">{intelligence.medical_type}</Badge>
      )}
      {intelligence.condition && (
        <div className="text-[13px] font-medium text-white/70">{intelligence.condition}</div>
      )}
      {intelligence.treatment && (
        <div className="text-[11px] text-white/35">Treatment: {intelligence.treatment}</div>
      )}
      {intelligence.diagnosis && (
        <div className="text-[11px] text-white/35">Diagnosis: {intelligence.diagnosis}</div>
      )}
      {intelligence.clinical_trial_id && (
        <div className="text-[11px] text-white/35">Trial ID: {intelligence.clinical_trial_id}</div>
      )}
      {intelligence.publication_date && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <Calendar className="h-3 w-3" /> {intelligence.publication_date}
        </div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-white/30">
        <CheckCircle className="h-3 w-3" /> Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  );
}

function AcademicCard({ intelligence }) {
  return (
    <div className="space-y-1.5">
      {intelligence.academic_type && (
        <Badge variant="outline" className="text-[10px]">{intelligence.academic_type}</Badge>
      )}
      {intelligence.paper_title && (
        <div className="text-[13px] font-medium text-white/70">{intelligence.paper_title}</div>
      )}
      {intelligence.journal && (
        <div className="text-[11px] text-white/35">Journal: {intelligence.journal}</div>
      )}
      {intelligence.authors && intelligence.authors.length > 0 && (
        <div className="text-[11px] text-white/35">
          Authors: {intelligence.authors.slice(0, 3).join(', ')}
          {intelligence.authors.length > 3 && ' et al.'}
        </div>
      )}
      {intelligence.doi && (
        <div className="text-[11px] text-white/35">DOI: {intelligence.doi}</div>
      )}
      {intelligence.citation_count && (
        <div className="text-[11px] text-white/35">Citations: {intelligence.citation_count}</div>
      )}
      {intelligence.publication_date && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <Calendar className="h-3 w-3" /> {intelligence.publication_date}
        </div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-white/30">
        <CheckCircle className="h-3 w-3" /> Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  );
}

function FinancialCard({ intelligence }) {
  return (
    <div className="space-y-1.5">
      {intelligence.financial_type && (
        <Badge variant="outline" className="text-[10px]">{intelligence.financial_type}</Badge>
      )}
      {intelligence.company_name && (
        <div className="text-[13px] font-medium text-white/70">{intelligence.company_name}</div>
      )}
      {intelligence.ticker && (
        <Badge variant="secondary" className="text-[10px]">{intelligence.ticker}</Badge>
      )}
      {intelligence.revenue && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <DollarSign className="h-3 w-3" /> Revenue: {intelligence.revenue}
        </div>
      )}
      {intelligence.profit && (
        <div className="flex items-center gap-1 text-[11px] text-white/30">
          <DollarSign className="h-3 w-3" /> Profit: {intelligence.profit}
        </div>
      )}
      {intelligence.eps && (
        <div className="text-[11px] text-white/35">EPS: {intelligence.eps}</div>
      )}
      {intelligence.reporting_period && (
        <div className="text-[11px] text-white/35">Period: {intelligence.reporting_period}</div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-white/30">
        <CheckCircle className="h-3 w-3" /> Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  );
}
