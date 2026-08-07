# Ultra Search Browser

Ultra Search Browser is an Occu-Med procurement intelligence layer built on top of ordinary web search. It is **not** a standalone search engine and its core search workflow requires **zero search API keys**.

The app's job is to make normal browser search dramatically more useful for Occu-Med: understand the procurement intent, generate targeted buyer-language queries, ingest ordinary search-result cards, discard junk, identify plausible opportunities, inspect destination evidence, and surface only opportunities that survive the SHOW / REVIEW / REJECT gate.

## Core architecture

```text
User request
    ↓
Deterministic Occu-Med intent + query planner
    ↓
Browser Companion
    ↓
Ordinary Google / Bing / DuckDuckGo / Brave result pages
    ↓
Visible SERP cards returned to Ultra Search
    ↓
Intent gate + hard exclusions + Occu-Med relevance filter
    ↓
Deep destination-page / document / lifecycle validation
    ↓
SHOW / REVIEW / REJECT
    ↓
Feedback + pursuit learning
```

### What the server does

- Models the user's procurement intent without requiring an external AI planner.
- Expands searches using the Occu-Med capability profile and buyer-language vocabulary.
- Builds broad, official-source, direct-document, and capability-specific search variants.
- Normalizes and deduplicates browser-fed result cards.
- Rejects generic pages, jobs, definitions, marketing pages, expired notices, unrelated medical work, and other known junk patterns.
- Applies the Occu-Med relevance profile, historical-pursuit patterns, and hard exclusions.
- Opens promising destination pages and supported documents for evidence review.
- Detects solicitation identity, lifecycle, due dates, amendments, attachments, and duplicate opportunities.
- Applies the mandatory SHOW / REVIEW / REJECT decision gate.
- Stores bookmarks, feedback, and pursuit learning when PostgreSQL is configured.

### What the server does **not** do

The Render service does not pretend to be a public search engine. The default `/api/search` route does not scrape Google/Bing/DDG pages and does not depend on SAM.gov, Gemini grounding, Tavily, Serper, Exa, Firecrawl, Brave Search API, or another paid/trial search provider to produce results.

`/api/search` is now a compatibility endpoint that returns `BROWSER_RESULTS_REQUIRED`. The live retrieval path is:

1. `/api/search/plan`
2. Browser Companion executes the search plan in the user's browser
3. `/api/search/ingest`
4. `/api/search/validate`

## Browser Companion

The `browser-extension` directory contains the Manifest V3 Chrome/Chromium companion used as the retrieval transport.

It opens ordinary search-result pages in inactive browser tabs, extracts the visible result title, destination URL, and snippet, closes the tabs, and sends those raw candidates back to Ultra Search. The server remains responsible for canonical URL deduplication, overlap scoring, Occu-Med filtering, and validation.

### Install the companion

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome, Edge, Brave, or another Chromium browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's `browser-extension` folder.
6. Open Ultra Search Browser and use **Settings → Browser retrieval** to confirm the companion is connected.

No search-provider account or API key is required for this core workflow.

## Occu-Med search intelligence

The procurement pipeline is designed around Occu-Med rather than generic government contracting. Its search and validation logic includes:

- Occu-Med capability profile
- buyer-language dictionary and equivalent terminology
- hard exclusion rules
- relevant / irrelevant examples
- historical pursuit patterns
- procurement-intent evidence requirements
- source and destination quality checks
- lifecycle and expiration detection
- complete solicitation-package inspection
- attachment and amendment inspection
- entity and solicitation deduplication
- feedback-based pursuit ranking

Broad umbrella searches such as `Occupational Health Services RFP` stay broad across the full Occu-Med service ontology, while specific service searches remain appropriately narrow.

## Search lifecycle

### 1. Plan

`POST /api/search/plan` builds a deterministic zero-key search plan. Production health reports:

- `browserFedSearch: true`
- `coreSearchApiKeysRequired: false`
- `serverSideSearchRetrieval: false`
- pipeline `rfp-finder-v5-browser-fed-zero-key`

### 2. Retrieve in the browser

The companion runs bounded search waves against ordinary browser search pages. Google, Bing, DuckDuckGo, and Brave are browser fallbacks, not server-side API dependencies.

### 3. Ingest and filter

`POST /api/search/ingest` accepts browser SERP cards and applies:

- URL cleanup and tracking-parameter removal
- cross-query / cross-engine deduplication
- intent candidate gate
- Occu-Med local smart filter
- hard exclusions
- feedback reranking

Candidate-stage confidence intentionally remains `0` until destination evidence is verified.

### 4. Deep validate

`POST /api/search/validate` opens promising pages and supported documents, classifies availability and lifecycle, extracts structured procurement intelligence, and applies the mandatory Occu-Med decision gate.

Only `SHOW` results are promoted as verified matches. `REVIEW`, expired, dead, rejected, and duplicate results remain available in evidence buckets without being presented as confirmed opportunities.

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then load the `browser-extension` directory as an unpacked Chromium extension.

## Environment variables

The core browser-fed search pipeline does not require search API keys.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No | Persistent bookmarks, feedback, pursuit learning, history, and search memory |
| `ENABLE_LOCAL_EMBEDDINGS=true` | No | Enables the local MiniLM embedding model |
| `ENABLE_OCR=true` | No | Enables OCR for images and scanned documents |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | No | Optional semantic reranking enhancement |
| `CEREBRAS_API_KEY` | No | Optional evidence-review enhancement |
| `GROQ_API_KEY` | No | Optional fallback evidence-review enhancement |

Optional enhancements are never required to obtain browser search results. Candidate filtering in the browser-fed default path runs without external model providers.

Legacy search-provider adapters may remain in the codebase for diagnostics or historical compatibility, but they are not part of the default frontend path or the production acceptance contract.

## Verification

```bash
npm run typecheck
npm run test:settings
npm run build
```

Or run the complete local verification command:

```bash
npm run verify
```

Additional database checks:

```bash
npm run check:pgvector
npm run smoke:pgvector
```

The production smoke test waits for Render to serve the exact pushed commit and verifies the browser-fed contract without requiring a third-party search provider. It checks deterministic query planning, browser-style SERP ingestion, junk rejection, retirement of server-side retrieval, deep Occu-Med SHOW validation, and non-persistence of the synthetic validation fixture.

## Render deployment

Create a Web Service connected to this repository with:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Node version:** 22
- **Health endpoint:** `/api/health`

`DATABASE_URL` and the optional enhancement variables above can be added as needed. Search-provider API keys are not required for the core app.

## Stack

- Next.js 16 App Router
- React 19 and TypeScript
- Tailwind CSS
- Chrome/Chromium Manifest V3 companion extension
- Cheerio
- pdf-parse
- Mammoth
- Tesseract.js
- PostgreSQL and pgvector
- Radix UI primitives

## License

MIT
