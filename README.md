# Ultra Search Browser

Ultra Search Browser is an Occu-Med procurement intelligence layer over live web search. It is **not** a standalone search index. Neon/PostgreSQL is used for persistence, bookmarks, feedback, and pursuit learning; discovery comes from live search sources.

The application remains usable without paid search credentials: private SearXNG plus the bounded direct-engine fallback provide a zero-key path. When renewable search API keys are configured, those providers join the normal live discovery fan-out.

## Core architecture

```text
User request
    ↓
Deterministic Occu-Med intent + buyer-language planner
    ↓
Parallel live retrieval
    ├─ Private SearXNG primary metasearch
    │    └─ Google CSE / Bing / DuckDuckGo / Brave /
    │       Startpage / Qwant / Mojeek / Yahoo
    ├─ Keenable
    ├─ TinyFish Search
    ├─ Tavily
    ├─ Exa
    └─ LangSearch
    ↓
If aggregate primary coverage is weak only:
Direct Google / DuckDuckGo / Bing fallback
    ↓
Merged raw candidates
    ↓
Intent gate + hard exclusions + Occu-Med relevance filter
    ↓
Deep destination-page / document / lifecycle validation
    ↓
Optional Cerebras → Groq post-validation evidence review
    ↓
SHOW / REVIEW / REJECT
    ↓
Neon/PostgreSQL persistence, bookmarks, feedback, pursuit learning
```

**Google, Bing, and DuckDuckGo are not rescue-only sources.** Ultra Search explicitly requests them as part of its normal SearXNG engine ensemble. The separate direct Google/DuckDuckGo/Bing rescue pass is an additional fallback transport used only when aggregate primary coverage is unexpectedly sparse.

## Live discovery sources

### SearXNG

SearXNG is the primary private metasearch transport. By default Ultra Search explicitly requests:

- Google CSE
- Brave
- DuckDuckGo
- Startpage
- Bing
- Qwant
- Mojeek
- Yahoo

`SEARXNG_ENGINES` can override that deployment-level list. Individual upstream engines may still fail or be unavailable; Ultra Search records observed engine provenance and keeps other sources independent.

### Keenable

Keenable is a first-class live-web discovery source. `KEENABLE_API_KEY`, `_2`, and `_3` form a rotating pool. The starting key rotates between requests and all configured keys remain available for same-request authentication/quota failover.

### TinyFish

TinyFish Search supplies fresh ranked web results with titles, snippets, and URLs. Ultra Search uses only the documented Search API query, location, and language parameters.

### Tavily

Tavily runs in the normal search fan-out when configured. `TAVILY_API_KEY` through `_4` form one rotating pool with full same-request failover.

### Exa

Exa adds semantic/live-web retrieval. Ultra Search requests dynamic highlights so Exa candidates reach the Occu-Med relevance gate with useful evidence instead of title/URL-only records. Exa calls are capped at 10 results to conserve recurring free credit.

`EXA_SEARCH_API_KEY`, `_2`, and `_3` form one rotating pool with full same-request failover.

### LangSearch

LangSearch provides another independent web-search path and feeds its snippets into the same relevance, validation, and deduplication pipeline.

## What Ultra Search does

- Models procurement intent without requiring an external AI planner.
- Expands searches using the Occu-Med capability profile and buyer-language vocabulary.
- Builds broad, official-source, direct-document, procurement-portal, freshness, and capability-specific query variants.
- Fans those variants across independent live search sources.
- Measures retrieval coverage using canonical distinct destinations and query diversity rather than raw result count.
- Merges and deduplicates cross-query / cross-engine / cross-provider candidates.
- Rejects generic pages, jobs, definitions, unrelated patient care, marketing noise, expired notices, and other known junk patterns.
- Applies the Occu-Med relevance profile, hard exclusions, relevant/irrelevant examples, historical pursuit patterns, and feedback learning.
- Opens promising destination pages and supported documents for evidence review.
- Detects solicitation identity, lifecycle, due dates, amendments, attachments, and duplicate opportunities.
- Sends scanned/image-only procurement documents and thin client-rendered procurement portals to REVIEW instead of falsely calling them junk.
- Applies the mandatory SHOW / REVIEW / REJECT decision gate.
- Stores bookmarks, feedback, and pursuit learning in Neon/PostgreSQL when configured; persistence is bounded and fail-open.

## Search lifecycle

### 1. Plan

`POST /api/search/plan` creates the deterministic Occu-Med query plan.

### 2. Retrieve

`POST /api/search` runs the plan server-side. SearXNG, Keenable, TinyFish, Tavily, Exa, and LangSearch participate when configured. A failure in one source does not establish a zero-result conclusion and does not stop the other sources.

When aggregate primary coverage is insufficient, Ultra Search can run the separate bounded direct Google/DuckDuckGo/Bing rescue pass. Rescue favors official, direct-document, portal, buyer-language, and freshness strategies rather than spending its limited slots on generic searches.

The retrieval response exposes source configuration, key-pool counts, per-source diagnostics, circuit-breaker health, candidate counts, and transport provenance.

### 3. Ingest and filter

`POST /api/search/ingest` applies:

- URL cleanup and tracking-parameter removal
- cross-query / cross-engine / cross-provider deduplication
- procurement intent gate
- Occu-Med smart filter
- hard exclusions
- bounded feedback reranking

Candidate confidence intentionally remains `0` until destination evidence is verified.

### 4. Deep validate

`POST /api/search/validate` opens promising pages and supported documents, classifies availability and lifecycle, extracts procurement intelligence, inspects linked solicitation packages, and applies the mandatory Occu-Med decision gate.

Only `SHOW` results are promoted as verified matches. `REVIEW`, expired, dead, rejected, and duplicate results remain in evidence buckets without being presented as confirmed opportunities.

When `ENABLE_EXTERNAL_SMART_FILTER=true`, deep validation can use the Cerebras key pool followed by Groq fallback/review. Initial candidate retrieval/filtering stays local so reviewer credits are not spent on every raw search result.

## Persistence

Neon/PostgreSQL remains the persistence layer for:

- bookmarks
- search history
- feedback
- pursuit learning
- verified vector/search memory

The live discovery APIs are **not** being used as a replacement bookmark database.

## Runtime contract

Production health reports the `rfp-finder-v7-multisource` pipeline and exposes, among other fields:

- `browserCompanionRequired: false`
- `downloadsRequired: false`
- `extensionsRequired: false`
- `serverSideSearchRetrieval: true`
- `searxngSearch: true`
- `liveMultiSourceSearch: true`
- `liveSearchSources`
- `searxngRequestedEngines`
- `coreSearchApiKeysRequired: false`
- `zeroKeyDirectRescue: true`
- Cerebras key count and external-review enabled state

`coreSearchApiKeysRequired: false` means the application retains a zero-key fallback architecture; it does **not** mean configured Keenable/TinyFish/Tavily/Exa/LangSearch keys are ignored.

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No browser extension is required.

## Environment variables

### Primary metasearch

| Variable | Required | Purpose |
| --- | --- | --- |
| `SEARXNG_URL` | Recommended | Private SearXNG service URL |
| `SEARXNG_ENGINES` | No | Explicit SearXNG primary engine ensemble; defaults to Google CSE, Brave, DuckDuckGo, Startpage, Bing, Qwant, Mojeek, Yahoo |

### Live search APIs

| Variable | Required | Purpose |
| --- | --- | --- |
| `KEENABLE_API_KEY` through `_3` | No | Keenable rotating live-search key pool |
| `KEENABLE_SEARCH_MODE` | No | Keenable search mode; defaults to `pro` |
| `KEENABLE_MAX_VARIANTS` | No | Keenable query-variant budget |
| `KEENABLE_TIMEOUT_MS` | No | Keenable request timeout |
| `TINYFISH_API_KEY` | No | TinyFish Search |
| `TINYFISH_MAX_VARIANTS` | No | TinyFish query-variant budget |
| `TAVILY_API_KEY` through `_4` | No | Tavily rotating key pool |
| `TAVILY_MAX_VARIANTS` | No | Tavily query-variant budget |
| `EXA_SEARCH_API_KEY` through `_3` | No | Exa rotating key pool |
| `EXA_MAX_VARIANTS` | No | Exa query-variant budget |
| `LANGSEARCH_API_KEY` | No | LangSearch live web search |
| `LANGSEARCH_MAX_VARIANTS` | No | LangSearch query-variant budget |

### Evidence review and persistence

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No | Persistent bookmarks, feedback, pursuit learning, history, and search memory |
| `CEREBRAS_API_KEY` + `_2` | No | Rotating post-validation semantic reviewer pool |
| `GROQ_API_KEY` | No | Fallback/reviewer after Cerebras |
| `ENABLE_EXTERNAL_SMART_FILTER=true` | No | Enables Cerebras/Groq during deep validation; off by default |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | No | Optional semantic reranking experiment |
| `ENABLE_LOCAL_EMBEDDINGS=true` | No | Enables the local MiniLM embedding model |
| `ENABLE_OCR=true` | No | Enables OCR for images and scanned documents |

See `.env.example` for all tuning variables.

## SearXNG requirements

The private SearXNG instance must allow JSON results in `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

Ultra Search calls `/search` with `format=json`, `categories=general`, Safe Search, and an explicit `engines=` ensemble. The SearXNG deployment still controls which upstream engines are actually functional.

## Verification

```bash
npm run typecheck
npm run test:settings
npm run build
```

Or:

```bash
npm run verify
```

The production smoke contract verifies the exact deployed commit, the multi-source health contract, explicit SearXNG Google/Bing/DuckDuckGo primary ensemble, valid live transport provenance, Occu-Med candidate filtering, deep SHOW validation, and non-persistence of synthetic validation evidence. The live `occupational health services` plan → retrieval → ingest canary also checks that provider-page leakage does not survive the procurement gate.

## Render deployment

Main app:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Node version:** 22
- **Health endpoint:** `/api/health`

Set `SEARXNG_URL` plus whichever renewable search-provider keys you want active. `/api/health` reports which sources are actually configured and how many keys each pool sees without exposing key values.

## Stack

- Next.js 16 App Router
- React 19 and TypeScript
- Tailwind CSS
- SearXNG metasearch
- Keenable
- TinyFish Search
- Tavily
- Exa
- LangSearch
- Cerebras / Groq optional evidence review
- Cheerio
- pdf-parse
- Mammoth
- Tesseract.js
- PostgreSQL and pgvector
- Radix UI primitives

## License

MIT