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
    │    └─ Google / Google CSE / Bing / DuckDuckGo / Brave /
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

**Google, Google CSE, Bing, and DuckDuckGo are not rescue-only sources.** Ultra Search explicitly requests them as part of its normal SearXNG engine ensemble. The separate direct Google/DuckDuckGo/Bing rescue pass is an additional fallback transport used only when aggregate primary coverage is unexpectedly sparse.

## Live discovery sources

### SearXNG

SearXNG is the primary private metasearch transport. By default Ultra Search explicitly requests:

- Google
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

Keenable is a first-class live-web discovery source. `KEENABLE_API_KEY`, `KEENABLE_API_KEY_2`, `KEENABLE_API_KEY_3`, and `KEENABLE_API_KEY_4` form a rotating four-key pool. The starting key rotates between requests and all configured keys remain available for same-request authentication/quota failover.

### TinyFish

TinyFish Search supplies fresh ranked web results with titles, snippets, and URLs. Ultra Search uses only the documented Search API query, location, and language parameters.

### Tavily

Tavily runs in the normal search fan-out when configured. `TAVILY_API_KEY` through `TAVILY_API_KEY_4` form one rotating pool with full same-request failover.

### Exa

Exa adds semantic/live-web retrieval. Ultra Search requests dynamic highlights so Exa candidates reach the Occu-Med relevance gate with useful evidence instead of title/URL-only records. Exa calls are capped at 10 results to conserve recurring free credit.

`EXA_SEARCH_API_KEY`, `EXA_SEARCH_API_KEY_2`, `EXA_SEARCH_API_KEY_3`, and `EXA_SEARCH_API_KEY_4` form one rotating four-key pool with full same-request failover.

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

The website calls `POST /api/search`. The server executes the plan across SearXNG plus every configured live discovery provider. If aggregate primary coverage is sparse, Ultra Search can invoke a bounded direct Google/DuckDuckGo/Bing fallback.

Search-provider API keys are optional accelerators, not a requirement for the application to function.

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

When `ENABLE_EXTERNAL_SMART_FILTER=true`, Cerebras/Groq may assist with post-validation semantic evidence review. They are not required for retrieval and fail open to the local evidence path.

## Runtime contract

Production health reports the `rfp-finder-v7-multisource` pipeline and exposes:

- `browserCompanionRequired: false`
- `downloadsRequired: false`
- `extensionsRequired: false`
- `serverSideSearchRetrieval: true`
- `liveMultiSourceSearch: true`
- `searxngSearch: true`
- `coreSearchApiKeysRequired: false`
- `zeroKeyDirectRescue: true`

Health also exposes the live source configuration and key-pool counts without exposing credential values.

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No browser extension is required.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SEARXNG_URL` | Recommended | URL of the private SearXNG service |
| `SEARXNG_ENGINES` | No | Override the primary SearXNG engine ensemble |
| `KEENABLE_API_KEY` … `_4` | No | Keenable renewable live-search pool |
| `TINYFISH_API_KEY` | No | TinyFish Search live web retrieval |
| `TAVILY_API_KEY` … `_4` | No | Tavily renewable live-search pool |
| `EXA_SEARCH_API_KEY` … `_4` | No | Exa renewable live-search pool |
| `LANGSEARCH_API_KEY` | No | LangSearch live web retrieval |
| `DATABASE_URL` | No | Persistent bookmarks, feedback, pursuit learning, history, and search memory |
| `ENABLE_LOCAL_EMBEDDINGS=true` | No | Enables the local MiniLM embedding model |
| `ENABLE_OCR=true` | No | Enables OCR for images and scanned documents |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | No | Optional semantic reranking experiment |
| `CEREBRAS_API_KEY` + `_2` | No | Optional post-validation semantic reviewer pool |
| `GROQ_API_KEY` | No | Optional semantic review fallback |
| `ENABLE_EXTERNAL_SMART_FILTER=true` | No | Enables Cerebras/Groq after deep evidence validation |

## SearXNG requirements

The private SearXNG instance must allow JSON results in `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

Ultra Search calls the SearXNG `/search` endpoint with `format=json`, `categories=general`, Safe Search, and its explicit engine ensemble unless `SEARXNG_ENGINES` overrides it.

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

The production smoke contract verifies the exact deployed commit, deterministic planning, live multi-source retrieval, Occu-Med candidate filtering, deep SHOW validation, non-persistence of synthetic validation evidence, and nine live capability-family plan → retrieval → ingest canaries.

## Render deployment

Main app:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Node version:** 22
- **Health endpoint:** `/api/health`

Set `SEARXNG_URL` for the private SearXNG deployment and configure whichever renewable search providers you want active. The website remains functional without an extension or local software.

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
- Cheerio
- pdf-parse
- Mammoth
- Tesseract.js
- PostgreSQL and pgvector
- Radix UI primitives

## License

MIT