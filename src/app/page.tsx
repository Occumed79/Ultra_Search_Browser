"use client";

import {
  Search, Zap, Database, Activity, Sparkles, Star,
  ExternalLink, Clock, Globe, AlertTriangle, TrendingUp, FileText, Building2, Code, Newspaper, Stethoscope,
  Calendar, DollarSign, MapPin, Phone, Mail, CheckCircle, Scale, GraduationCap, TrendingUp as TrendingUpIcon, Briefcase,
  ArrowUpDown, Download, Filter, X
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Header } from "../components/header";
import { SearchBar } from "../components/search-bar";
import { useSearch } from "../hooks/use-search";
import { type SearchLens, type ScrapedResult, type ProcurementIntelligence, type ProviderIntelligence, type PricingIntelligence, type LegalIntelligence, type MedicalIntelligence, type AcademicIntelligence, type FinancialIntelligence } from "../types/search";
import { useState, useMemo } from "react";

const LENSES: { id: SearchLens; label: string; icon: typeof Search }[] = [
  { id: "web", label: "Web", icon: Search },
  { id: "pdf", label: "PDF", icon: FileText },
  { id: "government", label: "Government", icon: Building2 },
  { id: "procurement", label: "Procurement", icon: Database },
  { id: "pricing", label: "Pricing", icon: Zap },
  { id: "provider", label: "Provider", icon: Stethoscope },
  { id: "technical", label: "Technical", icon: Code },
  { id: "news", label: "News", icon: Newspaper },
  { id: "legal", label: "Legal", icon: Scale },
  { id: "medical", label: "Medical", icon: Stethoscope },
  { id: "academic", label: "Academic", icon: GraduationCap },
  { id: "financial", label: "Financial", icon: Briefcase },
];

const SOURCE_COLORS: Record<string, string> = {
  Google: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  Bing: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  DuckDuckGo: "bg-orange-500/10 text-orange-600 border-orange-500/30",
};

export default function Home() {
  const {
    query, setQuery, lens, setLens,
    intelligence, scrapedResults, isLoading, error, suggestions,
    hasSearched, searchTime, performSearch,
  } = useSearch();

  // UI state for filtering and sorting
  const [sortBy, setSortBy] = useState<'score' | 'rank' | 'source'>('score')
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  // Get unique sources
  const sources = useMemo(() => {
    const uniqueSources = new Set(scrapedResults.map(r => r.source))
    return Array.from(uniqueSources)
  }, [scrapedResults])

  // Filter and sort results
  const filteredResults = useMemo(() => {
    let results = [...scrapedResults]

    // Filter by source
    if (filterSource) {
      results = results.filter(r => r.source === filterSource)
    }

    // Sort
    results.sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score
      if (sortBy === 'rank') return a.rank - b.rank
      if (sortBy === 'source') return a.source.localeCompare(b.source)
      return 0
    })

    return results
  }, [scrapedResults, sortBy, filterSource])

  // Export results
  const exportResults = (format: 'json' | 'csv') => {
    // Sanitize query for safe filename
    const safeQuery = query.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 50)
    const timestamp = new Date().toISOString()
    
    if (format === 'json') {
      const data = JSON.stringify({
        metadata: {
          query,
          lens,
          timestamp,
          resultCount: filteredResults.length,
        },
        results: filteredResults,
      }, null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `search-results-${safeQuery}-${timestamp}.json`
      a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'csv') {
      const headers = ['Title', 'URL', 'Description', 'Source', 'Score', 'Rank']
      const rows = filteredResults.map(r => [
        `"${(r.title || '').replace(/"/g, '""')}"`,
        `"${r.url}"`,
        `"${(r.description || '').replace(/"/g, '""')}"`,
        `"${r.source}"`,
        r.score ?? 0,
        r.rank ?? 0,
      ])
      const csv = [
        `"Metadata","Query: ${query}","Lens: ${lens}","Timestamp: ${timestamp}","Results: ${filteredResults.length}"`,
        headers.join(','),
        ...rows.map(r => r.join(','))
      ].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `search-results-${safeQuery}-${timestamp}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header onToggleFilters={() => {}} onToggleShortcuts={() => {}} />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          {!hasSearched && (
            <div className="text-center mb-10">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                <span className="text-gradient">Ultra</span>Search
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                A search browser more powerful than Kagi. Multi-engine aggregation,
                query intelligence, signal scoring, and structured results — all without API keys.
              </p>
            </div>
          )}

          {/* Lenses */}
          <div className="flex flex-wrap gap-2 justify-center mb-4">
            {LENSES.map((l) => (
              <button
                key={l.id}
                onClick={() => setLens(l.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  lens === l.id
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-muted border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/80"
                }`}
              >
                <l.icon className="w-3.5 h-3.5" />
                {l.label}
              </button>
            ))}
          </div>

          <SearchBar
            query={query}
            setQuery={setQuery}
            onSearch={performSearch}
            suggestions={suggestions}
            isLoading={isLoading}
          />
        </div>

        {hasSearched && (
          <div className="max-w-3xl mx-auto mt-8">
            {/* Meta */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {filteredResults.length} results
                  {filterSource && ` (filtered from ${scrapedResults.length})`}
                </span>
                <Badge variant="outline" className="text-xs capitalize">
                  {lens}
                </Badge>
                {filterSource && (
                  <Badge variant="secondary" className="text-xs flex items-center gap-1">
                    {filterSource}
                    <button onClick={() => setFilterSource(null)} className="hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {searchTime.toFixed(0)}ms
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="h-7 px-2"
                >
                  <Filter className="w-3.5 h-3.5 mr-1" />
                  Filters
                </Button>
              </div>
            </div>

            {/* Filter/Sort Controls */}
            {showFilters && (
              <div className="mb-4 p-3 bg-muted/50 rounded-lg border">
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Sort by:</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as 'score' | 'rank' | 'source')}
                      className="text-xs bg-background border rounded px-2 py-1"
                    >
                      <option value="score">Score</option>
                      <option value="rank">Rank</option>
                      <option value="source">Source</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Filter by source:</span>
                    <select
                      value={filterSource || ''}
                      onChange={(e) => setFilterSource(e.target.value || null)}
                      className="text-xs bg-background border rounded px-2 py-1"
                    >
                      <option value="">All sources</option>
                      {sources.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-muted-foreground">Export:</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportResults('json')}
                      className="h-7 px-2 text-xs"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      JSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportResults('csv')}
                      className="h-7 px-2 text-xs"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      CSV
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-6 p-4 rounded-lg border border-destructive bg-destructive/10 text-destructive">
                <p className="font-medium">Error</p>
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* AI Summary */}
            {intelligence && (
              <div className="rounded-xl border bg-card p-5 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h3 className="font-medium">AI Summary</h3>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {intelligence.confidence}% confidence
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {intelligence.summary || `Results for "${intelligence.query}" using ${intelligence.lens} lens.`}
                </p>

                {intelligence.queryExpansions.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Related Searches
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {intelligence.queryExpansions.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => { setQuery(q); performSearch(); }}
                          className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors border"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {intelligence.signals.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {intelligence.signals.map((sig, i) => (
                      <span
                        key={i}
                        className={`text-xs px-2 py-1 rounded-full border ${
                          sig.score > 0
                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                            : "bg-red-500/10 text-red-600 border-red-500/30"
                        }`}
                        title={sig.description}
                      >
                        {sig.name} {sig.score > 0 ? "+" : ""}{sig.score}
                      </span>
                    ))}
                  </div>
                )}

                {intelligence.note && (
                  <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <p className="text-xs text-amber-600">{intelligence.note}</p>
                  </div>
                )}
              </div>
            )}

            {/* Search Results */}
            <div className="space-y-4">
              {filteredResults.map((result, index) => (
                <SearchResultCard key={result.url + index} result={result} index={index} />
              ))}
            </div>

            {filteredResults.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium">No web results found</h3>
                <p className="text-muted-foreground">Try a different query or check your connection</p>
              </div>
            )}
          </div>
        )}

        {!hasSearched && !isLoading && (
          <div className="max-w-4xl mx-auto mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Multi-Engine", description: "Aggregates DuckDuckGo, Bing, and Google results simultaneously for maximum coverage.", icon: <Globe className="w-6 h-6 text-blue-500" /> },
              { title: "Query Intelligence", description: "Automatically expands queries with synonyms, operators, and vertical-specific terms.", icon: <Sparkles className="w-6 h-6 text-amber-500" /> },
              { title: "Signal Scoring", description: "Ranks results using domain authority, content signals, and source trust metrics.", icon: <Star className="w-6 h-6 text-emerald-500" /> },
            ].map((feature, i) => (
              <div key={i} className="p-6 rounded-xl border bg-card hover:shadow-lg transition-all duration-300 group">
                <div className="mb-4 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SearchResultCard({ result, index }: { result: ScrapedResult; index: number }) {
  const domain = (() => {
    try { return new URL(result.url).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();

  const sourceStyle = SOURCE_COLORS[result.source] || "bg-muted text-muted-foreground border";

  return (
    <div
      className="group rounded-xl border bg-card p-4 hover:shadow-md transition-all"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start gap-3">
        {/* Favicon */}
        <div className="mt-1 flex-shrink-0">
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
            alt=""
            className="w-5 h-5 rounded"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          {/* Source + time */}
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${sourceStyle}`}>
              {result.source}
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Rank #{result.rank || index + 1}
            </span>
          </div>

          {/* Title + URL */}
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block group/link"
          >
            <h3 className="text-base font-medium text-primary hover:underline line-clamp-1">
              {result.title}
            </h3>
            <p className="text-xs text-green-700 dark:text-green-400 line-clamp-1 mt-0.5">
              {result.url}
            </p>
          </a>

          {/* Description */}
          {result.description && (
            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
              {result.description}
            </p>
          )}

          {/* Intelligence Object Display */}
          {result.intelligence && (
            <div className="mt-3 p-2 bg-muted/50 rounded-lg border">
              {isProcurementIntelligence(result.intelligence) && (
                <ProcurementCard intelligence={result.intelligence} />
              )}
              {isProviderIntelligence(result.intelligence) && (
                <ProviderCard intelligence={result.intelligence} />
              )}
              {isPricingIntelligence(result.intelligence) && (
                <PricingCard intelligence={result.intelligence} />
              )}
              {isLegalIntelligence(result.intelligence) && (
                <LegalCard intelligence={result.intelligence} />
              )}
              {isMedicalIntelligence(result.intelligence) && (
                <MedicalCard intelligence={result.intelligence} />
              )}
              {isAcademicIntelligence(result.intelligence) && (
                <AcademicCard intelligence={result.intelligence} />
              )}
              {isFinancialIntelligence(result.intelligence) && (
                <FinancialCard intelligence={result.intelligence} />
              )}
            </div>
          )}

          {/* Visit button */}
          <div className="flex items-center gap-2 mt-2">
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Visit
            </a>
            <span className="text-xs text-muted-foreground">{domain}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Type guards
function isProcurementIntelligence(obj: any): obj is ProcurementIntelligence {
  return obj && 'opportunity_type' in obj && 'organization' in obj
}

function isProviderIntelligence(obj: any): obj is ProviderIntelligence {
  return obj && 'provider_name' in obj && 'services_offered' in obj
}

function isPricingIntelligence(obj: any): obj is PricingIntelligence {
  return obj && 'service' in obj && 'price_cash' in obj
}

function isLegalIntelligence(obj: any): obj is LegalIntelligence {
  return obj && 'legal_type' in obj
}

function isMedicalIntelligence(obj: any): obj is MedicalIntelligence {
  return obj && 'medical_type' in obj
}

function isAcademicIntelligence(obj: any): obj is AcademicIntelligence {
  return obj && 'academic_type' in obj
}

function isFinancialIntelligence(obj: any): obj is FinancialIntelligence {
  return obj && 'financial_type' in obj
}

// Intelligence Card Components
function ProcurementCard({ intelligence }: { intelligence: ProcurementIntelligence }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {intelligence.opportunity_type}
        </Badge>
        {intelligence.status && (
          <Badge variant={intelligence.status === 'open' ? 'default' : 'secondary'} className="text-xs">
            {intelligence.status}
          </Badge>
        )}
      </div>
      <div className="text-sm font-medium">{intelligence.organization}</div>
      <div className="text-xs text-muted-foreground">{intelligence.service}</div>
      {intelligence.due_date && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          Due: {intelligence.due_date}
        </div>
      )}
      {intelligence.monetary_value && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <DollarSign className="h-3 w-3" />
          {intelligence.monetary_value}
        </div>
      )}
      {intelligence.procurement_email && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Mail className="h-3 w-3" />
          {intelligence.procurement_email}
        </div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  )
}

function ProviderCard({ intelligence }: { intelligence: ProviderIntelligence }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{intelligence.provider_name}</div>
      {intelligence.address && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {intelligence.address}
        </div>
      )}
      {intelligence.provider_phone && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Phone className="h-3 w-3" />
          {intelligence.provider_phone}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {intelligence.services_offered.map((service, i) => (
          <Badge key={i} variant="secondary" className="text-xs">
            {service}
          </Badge>
        ))}
      </div>
      {intelligence.credentials && intelligence.credentials.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {intelligence.credentials.map((cred, i) => (
            <Badge key={i} variant="outline" className="text-xs">
              {cred}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  )
}

function PricingCard({ intelligence }: { intelligence: PricingIntelligence }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{intelligence.provider_name}</div>
      <div className="text-xs text-muted-foreground">{intelligence.service}</div>
      {intelligence.price_cash && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <DollarSign className="h-3 w-3" />
          Cash: {intelligence.price_cash}
        </div>
      )}
      {intelligence.price_employer && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <DollarSign className="h-3 w-3" />
          Employer: {intelligence.price_employer}
        </div>
      )}
      {intelligence.price_range && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <DollarSign className="h-3 w-3" />
          Range: {intelligence.price_range}
        </div>
      )}
      {intelligence.payment_types && intelligence.payment_types.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {intelligence.payment_types.map((type, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {type}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  )
}

function LegalCard({ intelligence }: { intelligence: LegalIntelligence }) {
  return (
    <div className="space-y-2">
      {intelligence.legal_type && (
        <Badge variant="outline" className="text-xs">
          {intelligence.legal_type}
        </Badge>
      )}
      {intelligence.case_name && (
        <div className="text-sm font-medium">{intelligence.case_name}</div>
      )}
      {intelligence.court && (
        <div className="text-xs text-muted-foreground">Court: {intelligence.court}</div>
      )}
      {intelligence.citation && (
        <div className="text-xs text-muted-foreground">Citation: {intelligence.citation}</div>
      )}
      {intelligence.decision_date && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {intelligence.decision_date}
        </div>
      )}
      {intelligence.statute_name && (
        <div className="text-xs text-muted-foreground">Statute: {intelligence.statute_name}</div>
      )}
      {intelligence.regulation_number && (
        <div className="text-xs text-muted-foreground">Regulation: {intelligence.regulation_number}</div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  )
}

function MedicalCard({ intelligence }: { intelligence: MedicalIntelligence }) {
  return (
    <div className="space-y-2">
      {intelligence.medical_type && (
        <Badge variant="outline" className="text-xs">
          {intelligence.medical_type}
        </Badge>
      )}
      {intelligence.condition && (
        <div className="text-sm font-medium">{intelligence.condition}</div>
      )}
      {intelligence.treatment && (
        <div className="text-xs text-muted-foreground">Treatment: {intelligence.treatment}</div>
      )}
      {intelligence.diagnosis && (
        <div className="text-xs text-muted-foreground">Diagnosis: {intelligence.diagnosis}</div>
      )}
      {intelligence.clinical_trial_id && (
        <div className="text-xs text-muted-foreground">Trial ID: {intelligence.clinical_trial_id}</div>
      )}
      {intelligence.publication_date && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {intelligence.publication_date}
        </div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  )
}

function AcademicCard({ intelligence }: { intelligence: AcademicIntelligence }) {
  return (
    <div className="space-y-2">
      {intelligence.academic_type && (
        <Badge variant="outline" className="text-xs">
          {intelligence.academic_type}
        </Badge>
      )}
      {intelligence.paper_title && (
        <div className="text-sm font-medium">{intelligence.paper_title}</div>
      )}
      {intelligence.journal && (
        <div className="text-xs text-muted-foreground">Journal: {intelligence.journal}</div>
      )}
      {intelligence.authors && intelligence.authors.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Authors: {intelligence.authors.slice(0, 3).join(', ')}
          {intelligence.authors.length > 3 && ' et al.'}
        </div>
      )}
      {intelligence.doi && (
        <div className="text-xs text-muted-foreground">DOI: {intelligence.doi}</div>
      )}
      {intelligence.citation_count && (
        <div className="text-xs text-muted-foreground">Citations: {intelligence.citation_count}</div>
      )}
      {intelligence.publication_date && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {intelligence.publication_date}
        </div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  )
}

function FinancialCard({ intelligence }: { intelligence: FinancialIntelligence }) {
  return (
    <div className="space-y-2">
      {intelligence.financial_type && (
        <Badge variant="outline" className="text-xs">
          {intelligence.financial_type}
        </Badge>
      )}
      {intelligence.company_name && (
        <div className="text-sm font-medium">{intelligence.company_name}</div>
      )}
      {intelligence.ticker && (
        <Badge variant="secondary" className="text-xs">
          {intelligence.ticker}
        </Badge>
      )}
      {intelligence.revenue && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <DollarSign className="h-3 w-3" />
          Revenue: {intelligence.revenue}
        </div>
      )}
      {intelligence.profit && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <DollarSign className="h-3 w-3" />
          Profit: {intelligence.profit}
        </div>
      )}
      {intelligence.eps && (
        <div className="text-xs text-muted-foreground">EPS: {intelligence.eps}</div>
      )}
      {intelligence.reporting_period && (
        <div className="text-xs text-muted-foreground">Period: {intelligence.reporting_period}</div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        Confidence: {intelligence.source_confidence}%
      </div>
    </div>
  )
}
