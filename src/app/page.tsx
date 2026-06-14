"use client";

import { useState } from "react";
import {
  Phone, Mail, Globe, Linkedin, Printer, Copy, ExternalLink,
  CheckCircle2, Zap, Target, Database, Activity, ChevronRight,
  Sparkles, AlertTriangle
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Header } from "../components/header";
import { SearchBar } from "../components/search-bar";
import { useSearch } from "../hooks/use-search";
import { type Vertical, type IntelligenceObject } from "../types/search";

const VERTICALS: { id: Vertical; label: string; icon: typeof Phone; color: string }[] = [
  { id: "contact", label: "Contact", icon: Phone, color: "text-blue-500" },
  { id: "procurement", label: "Procurement", icon: Target, color: "text-emerald-500" },
  { id: "provider", label: "Provider", icon: Database, color: "text-purple-500" },
  { id: "pricing", label: "Pricing", icon: Activity, color: "text-amber-500" },
  { id: "general", label: "General", icon: Zap, color: "text-slate-500" },
];

function ContactTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "phone": return <Phone className="w-4 h-4 text-emerald-500" />;
    case "email": return <Mail className="w-4 h-4 text-blue-500" />;
    case "fax": return <Printer className="w-4 h-4 text-amber-500" />;
    case "linkedin": return <Linkedin className="w-4 h-4 text-purple-500" />;
    case "website": return <Globe className="w-4 h-4 text-cyan-500" />;
    default: return <Globe className="w-4 h-4 text-slate-400" />;
  }
}

export default function Home() {
  const {
    query, setQuery, vertical, setVertical,
    intelligence, isLoading, error, suggestions,
    hasSearched, searchTime, performSearch,
  } = useSearch();

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = async (value: string, id: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onToggleFilters={() => {}} onToggleShortcuts={() => {}} />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {!hasSearched && (
            <div className="text-center mb-8">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                <span className="text-gradient">Omni</span>Intelligence
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Vertical intelligence search engine. Query expansion, signal scoring,
                and structured intelligence objects across contacts, procurement, providers, and pricing.
              </p>
            </div>
          )}

          {/* Vertical Selector */}
          <div className="flex flex-wrap gap-2 justify-center mb-4">
            {VERTICALS.map((v) => (
              <button
                key={v.id}
                onClick={() => setVertical(v.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  vertical === v.id
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-muted border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/80"
                }`}
              >
                <v.icon className={`w-3.5 h-3.5 ${vertical === v.id ? v.color : ""}`} />
                {v.label}
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
          <div className="max-w-4xl mx-auto mt-8">
            {/* Meta bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {intelligence?.contacts?.length || 0} vectors
                </span>
                <Badge variant="outline" className="text-xs">
                  {vertical}
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

            {intelligence && <IntelligenceReport data={intelligence} onCopy={copyToClipboard} copiedId={copiedId} />}
          </div>
        )}

        {!hasSearched && !isLoading && (
          <div className="max-w-4xl mx-auto mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Query Expansion", description: "Automatically expands queries with synonyms, operators, and vertical-specific terms.", icon: <Sparkles className="w-6 h-6 text-amber-500" /> },
              { title: "Signal Scoring", description: "Evaluates results using domain authority, document type, and content signals.", icon: <Activity className="w-6 h-6 text-emerald-500" /> },
              { title: "Intelligence Objects", description: "Returns structured data with confidence scores, not just raw links.", icon: <Database className="w-6 h-6 text-purple-500" /> },
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

function IntelligenceReport({ data, onCopy, copiedId }: {
  data: IntelligenceObject;
  onCopy: (value: string, id: string) => void;
  copiedId: string | null;
}) {
  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            <div>
              <h2 className="text-xl font-bold">{data.organization}</h2>
              <p className="text-xs text-muted-foreground">
                {data.contacts.length} contact vectors identified
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Confidence</div>
            <div className="text-2xl font-bold text-emerald-500">{data.confidence}%</div>
          </div>
        </div>

        {data.signals.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Signals</div>
            <div className="flex flex-wrap gap-2">
              {data.signals.map((sig, i) => (
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
          </div>
        )}

        {data.queryExpansions.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Query Expansions</div>
            <div className="flex flex-wrap gap-2">
              {data.queryExpansions.map((q, i) => (
                <Badge key={i} variant="secondary" className="text-xs font-normal">
                  {q}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {data.note && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <p className="text-xs text-amber-600">{data.note}</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {data.sources.map((src) => (
            <span key={src} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground border">
              {src}
            </span>
          ))}
        </div>
      </div>

      {/* Contacts Grid */}
      {data.contacts.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {data.contacts.map((contact) => (
            <div key={contact.id} className="rounded-xl border bg-card p-4 hover:shadow-md transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                    <ContactTypeIcon type={contact.type} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{contact.type}</div>
                    <div className="text-sm font-medium">{contact.label}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">Confidence</div>
                  <div className={`text-xs font-bold ${
                    contact.confidence > 90 ? "text-emerald-500" :
                    contact.confidence > 70 ? "text-blue-500" : "text-amber-500"
                  }`}>
                    {contact.confidence}%
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <code className="flex-1 text-sm text-foreground bg-muted px-3 py-2 rounded-lg border truncate">
                  {contact.value}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onCopy(contact.value, contact.id)}
                >
                  {copiedId === contact.id ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </Button>
                {(contact.type === "linkedin" || contact.type === "website") && (
                  <a
                    href={contact.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted transition-colors border"
                  >
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </a>
                )}
              </div>

              <div className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{contact.source}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
