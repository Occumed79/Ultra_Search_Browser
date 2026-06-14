"use client";

import {
  Search, Zap, Database, Activity, Sparkles, Star,
  ExternalLink, Clock, Globe, AlertTriangle, TrendingUp, FileText, Building2, Code, Newspaper, Stethoscope,
  Calendar, DollarSign, MapPin, Phone, Mail, CheckCircle, Scale, GraduationCap, TrendingUp as TrendingUpIcon, Briefcase
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Header } from "../components/header";
import { SearchBar } from "../components/search-bar";
import { useSearch } from "../hooks/use-search";
import { type SearchLens, type ScrapedResult, type ProcurementIntelligence, type ProviderIntelligence, type PricingIntelligence } from "../types/search";

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
                  {scrapedResults.length} results
                </span>
                <Badge variant="outline" className="text-xs capitalize">
                  {lens}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {searchTime.toFixed(0)}ms
              </span>
            </div>

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
              {scrapedResults.map((result, index) => (
                <SearchResultCard key={result.url + index} result={result} index={index} />
              ))}
            </div>

            {scrapedResults.length === 0 && !isLoading && (
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
