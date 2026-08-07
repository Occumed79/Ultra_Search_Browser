# Ultra Search Browser

Ultra Search Browser is an Occu-Med procurement intelligence layer over ordinary web search. It is **not** a standalone search index. The core workflow requires **no search API keys, browser extension, or local download**.

## Core architecture

```text
User request
    ↓
Deterministic Occu-Med intent + buyer-language planner
    ↓
Server-side retrieval
    ↓
Private SearXNG metasearch
    ↓
Brave / DuckDuckGo / Startpage / Bing / Qwant / Mojeek / Yahoo
    ↓
Merged raw candidates
    ↓
Intent gate + hard exclusions + Occu-Med relevance filter
    ↓
Deep destination-page / document / lifecycle validation
    ↓
SHOW / REVIEW / REJECT
    ↓
Feedback + pursuit learning
```

If the private SearXNG service is unavailable or the result pool is too sparse, Ultra Search makes a small zero-key direct DuckDuckGo/Bing rescue pass. That rescue is intentionally bounded and is not the preferred retrieval path.

## What Ultra Search does

- Models the user's procurement intent without requiring an external AI planner.
- Expands searches using Occu-Med capabilities and buyer-language vocabulary.
- Builds broad, official-source, direct-document, procurement-portal, and capability-specific query variants.
- Uses SearXNG as the preferred server-side metasearch transport.
- Merges and deduplicates cross-query / cross-engine candidates.
- Rejects generic pages, jobs, definitions, unrelated patient care, marketing noise, expired notices, and other known junk patterns.
- Applies the Occu-Med relevance profile, hard exclusions, relevant/irrelevant examples, historical pursuit patterns, and feedback learning.
- Opens promising destination pages and supported documents for evidence review.
- Detects solicitation identity, lifecycle, due dates, amendments, attachments, and duplicate opportunities.
- Applies the mandatory SHOW / REVIEW / REJECT decision gate.
- Stores bookmarks, feedback, and pursuit learning when PostgreSQL is configured.

## Search lifecycle

### 1. Plan

`POST /api/search/plan` creates the deterministic Occu-Med query plan.

### 2. Retrieve

The website calls `POST /api/search`. The server executes the plan through SearXNG. SearXNG aggregates its configured upstream web engines. No search-provider API key is required.

The default SearXNG engine request is:

- Brave
- DuckDuckGo
- Startpage
- Bing
- Qwant
- Mojeek
- Yahoo

Individual SearXNG engines can be disabled by the SearXNG instance when an upstream source is unhealthy. Ultra Search does not assume every engine succeeds on every request.

### 3. Ingest and filter

`POST /api/search/ingest` applies:

- URL cleanup and tracking-parameter removal
- cross-query / cross-engine deduplication
- procurement intent gate
- Occu-Med smart filter
- hard exclusions
- feedback reranking

Candidate confidence intentionally remains `0` until destination evidence is verified.

### 4. Deep validate

`POST /api/search/validate` opens promising pages and supported documents, classifies availability and lifecycle, extracts procurement intelligence, and applies the mandatory Occu-Med decision gate.

Only `SHOW` results are promoted as verified matches. `REVIEW`, expired, dead, rejected, and duplicate results remain in evidence buckets without being presented as confirmed opportunities.

## Runtime contract

Production health reports the `rfp-finder-v6-searxng-zero-key` pipeline and exposes:

- `browserCompanionRequired: false`
- `downloadsRequired: false`
- `extensionsRequired: false`
- `serverSideSearchRetrieval: true`
- `searxngSearch: true`
- `coreSearchApiKeysRequired: false`
- `zeroKeyDirectRescue: true`

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No browser extension is required.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SEARXNG_URL` | Recommended | URL of the private SearXNG service. Without it, Ultra Search uses only its bounded zero-key rescue path. |
| `DATABASE_URL` | No | Persistent bookmarks, feedback, pursuit learning, history, and search memory |
| `ENABLE_LOCAL_EMBEDDINGS=true` | No | Enables the local MiniLM embedding model |
| `ENABLE_OCR=true` | No | Enables OCR for images and scanned documents |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | No | Optional semantic reranking enhancement |
| `CEREBRAS_API_KEY` | No | Optional evidence-review enhancement |
| `GROQ_API_KEY` | No | Optional fallback evidence-review enhancement |

Search-provider API keys are not part of the core retrieval architecture.

## SearXNG requirements

The private SearXNG instance must allow JSON results in `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

Ultra Search calls the SearXNG `/search` endpoint with `format=json`, `categories=general`, Safe Search, and the configured web-engine ensemble.

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

The production smoke contract verifies the exact deployed commit, deterministic query planning, zero-key server retrieval, Occu-Med candidate filtering, deep SHOW validation, and non-persistence of synthetic validation evidence.

## Render deployment

Main app:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Node version:** 22
- **Health endpoint:** `/api/health`

Set `SEARXNG_URL` to the private SearXNG deployment once that service is available. The website remains functional without an extension or local software.

## Stack

- Next.js 16 App Router
- React 19 and TypeScript
- Tailwind CSS
- SearXNG metasearch
- Cheerio
- pdf-parse
- Mammoth
- Tesseract.js
- PostgreSQL and pgvector
- Radix UI primitives

## License

MIT
