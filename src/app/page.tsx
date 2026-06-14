"use client";

import { BookOpen, Command, ExternalLink, Loader2, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useSearch } from "../hooks/use-search";
import type { SearchLens, ScrapedResult } from "../types/search";

const LENSES: { id: SearchLens; label: string }[] = [
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

function sourceClass(source: string) {
  const normalized = source.toLowerCase();
  if (normalized.includes("google")) return "source-pill source-google";
  if (normalized.includes("bing")) return "source-pill source-bing";
  if (normalized.includes("duck")) return "source-pill source-duck";
  return "source-pill";
}

function ResultCard({ result, index }: { result: ScrapedResult; index: number }) {
  const score = Number.isFinite(result.score) ? Math.round(result.score) : 0;

  return (
    <article className="result-card liquid-glass">
      <div className="result-meta-row">
        <span className="result-rank">#{index + 1}</span>
        <span className={sourceClass(result.source)}>{result.source}</span>
        {result.resultType && <span className="result-type">{result.resultType}</span>}
        <span className="result-score">score {score}</span>
      </div>

      <h3 className="result-title">
        <a href={result.url} target="_blank" rel="noreferrer">
          {result.title || result.domain || result.url}
          <ExternalLink className="external-icon" aria-hidden="true" />
        </a>
      </h3>

      {result.description && <p className="result-description">{result.description}</p>}

      <div className="result-footer">
        <span className="result-domain">{result.domain}</span>
        {result.spamScore ? <span className="result-warning">spam signal {result.spamScore}</span> : null}
      </div>
    </article>
  );
}

export default function Home() {
  const {
    query,
    setQuery,
    lens,
    setLens,
    intelligence,
    scrapedResults,
    isLoading,
    error,
    suggestions,
    hasSearched,
    searchTime,
    performSearch,
  } = useSearch();

  const [sortBy, setSortBy] = useState<"score" | "rank" | "source">("score");
  const [filterSource, setFilterSource] = useState<string>("");

  const sources = useMemo(() => {
    return Array.from(new Set(scrapedResults.map((result) => result.source))).sort();
  }, [scrapedResults]);

  const filteredResults = useMemo(() => {
    const results = scrapedResults.filter((result) => !filterSource || result.source === filterSource);

    return [...results].sort((a, b) => {
      if (sortBy === "rank") return a.rank - b.rank;
      if (sortBy === "source") return a.source.localeCompare(b.source);
      return b.score - a.score;
    });
  }, [scrapedResults, filterSource, sortBy]);

  function submitSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!query.trim() || isLoading) return;
    performSearch();
  }

  function exportResults(format: "json" | "csv") {
    const safeQuery = (query || "search").replace(/[^a-zA-Z0-9-]/g, "_").substring(0, 50);
    const timestamp = new Date().toISOString();

    if (format === "json") {
      const data = JSON.stringify(
        {
          metadata: { query, lens, timestamp, resultCount: filteredResults.length },
          intelligence,
          results: filteredResults,
        },
        null,
        2,
      );
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ultra-search-${safeQuery}-${timestamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }

    const headers = ["Title", "URL", "Description", "Source", "Score", "Rank"];
    const rows = filteredResults.map((result) => [
      `"${(result.title || "").replace(/"/g, '""')}"`,
      `"${result.url}"`,
      `"${(result.description || "").replace(/"/g, '""')}"`,
      `"${result.source}"`,
      result.score ?? 0,
      result.rank ?? 0,
    ]);
    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ultra-search-${safeQuery}-${timestamp}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="ultra-page">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="ambient-sweep" aria-hidden="true" />

      <section className="app-shell">
        <header className="topbar liquid-glass">
          <a className="brand" href="/" aria-label="Ultra Search home">
            <span className="brand-icon"><Search aria-hidden="true" /></span>
            <span>Ultra Search</span>
          </a>

          <nav className="top-nav" aria-label="App navigation">
            <a href="/history">History</a>
            <a href="/bookmarks">Bookmarks</a>
            <a href="/settings">Settings</a>
          </nav>
        </header>

        <section className="search-workspace liquid-glass">
          <div className="workspace-heading">
            <p className="status-pill"><span /> Search browser</p>
            <h1>What are you looking for?</h1>
            <p>Search the web, RFPs, providers, pricing, PDFs, technical docs, and more.</p>
          </div>

          <form className="search-bar" onSubmit={submitSearch}>
            <Search className="search-icon" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search anything..."
              aria-label="Search query"
              autoFocus
            />
            <kbd><Command aria-hidden="true" />K</kbd>
            <button type="submit" disabled={isLoading || !query.trim()}>
              {isLoading ? <Loader2 className="spin" aria-hidden="true" /> : "Search"}
            </button>
          </form>

          <div className="lens-row" aria-label="Search lenses">
            {LENSES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLens(item.id)}
                className={lens === item.id ? "lens-pill active" : "lens-pill"}
              >
                {item.label}
              </button>
            ))}
          </div>

          {suggestions.length > 0 && query && !hasSearched && (
            <div className="suggestions">
              {suggestions.slice(0, 4).map((suggestion) => (
                <button type="button" key={suggestion.text} onClick={() => setQuery(suggestion.text)}>
                  {suggestion.text}
                </button>
              ))}
            </div>
          )}

          {hasSearched && (
            <section className="results-zone inline-results">
              <div className="results-toolbar">
                <div>
                  <strong>{filteredResults.length}</strong> results
                  <span>{searchTime.toFixed(0)}ms · {lens}</span>
                </div>

                <div className="toolbar-controls">
                  <select value={filterSource} onChange={(event) => setFilterSource(event.target.value)}>
                    <option value="">All sources</option>
                    {sources.map((source) => <option value={source} key={source}>{source}</option>)}
                  </select>

                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "score" | "rank" | "source")}>
                    <option value="score">Sort: Score</option>
                    <option value="rank">Sort: Rank</option>
                    <option value="source">Sort: Source</option>
                  </select>

                  <button type="button" onClick={() => exportResults("json")}>JSON</button>
                  <button type="button" onClick={() => exportResults("csv")}>CSV</button>
                </div>
              </div>

              {error && (
                <div className="error-panel">
                  <strong>Search failed</strong>
                  <span>{error}</span>
                </div>
              )}

              {intelligence && (
                <article className="intel-panel">
                  <div className="intel-heading">
                    <h2>Search intelligence</h2>
                    <span>{intelligence.confidence}% confidence</span>
                  </div>
                  <p>{intelligence.summary || `Results for “${intelligence.query}” using the ${intelligence.lens} lens.`}</p>

                  {intelligence.queryExpansions.length > 0 && (
                    <div className="intel-chips">
                      {intelligence.queryExpansions.slice(0, 8).map((expansion) => (
                        <button type="button" key={expansion} onClick={() => setQuery(expansion)}>
                          {expansion}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              )}

              <div className="results-list">
                {filteredResults.map((result, index) => (
                  <ResultCard key={`${result.url}-${index}`} result={result} index={index} />
                ))}
              </div>

              {!isLoading && filteredResults.length === 0 && !error && (
                <div className="empty-panel">
                  <BookOpen aria-hidden="true" />
                  <h2>No results came back yet.</h2>
                  <p>Try a broader query or switch lenses.</p>
                </div>
              )}
            </section>
          )}
        </section>
      </section>
    </main>
  );
}
