# Ultra Search Browser

Ultra Search Browser is a focused research search app that combines independent search APIs, query expansion, lens-aware ranking, asynchronous document enrichment, and optional PostgreSQL search memory.

## What is live

- Managed metasearch through Serper, Exa, LangSearch, Firecrawl Search, and
  Olostep Search, plus an optional self-hosted SearXNG source
- Web, PDF, Government, Procurement, Pricing, Provider, Technical, News, Legal, Medical, Academic, and Financial lenses
- Task-aware intent planning that separates the requested outcome, subject,
  capability, geography, dates, exclusions, and source preferences
- Meaning-preserving query expansion, automatic lens routing, and lens-specific ranking
- Fast initial results followed by bounded asynchronous enrichment
- HTML, PDF, and DOCX text extraction
- Optional OCR for images and scanned documents
- Structured intelligence extraction for supported lenses
- Safe Search, result-count, source-selection, display, and keyboard preferences
- Search history and bookmarks with browser fallback when PostgreSQL is unavailable
- PostgreSQL + pgvector persistence and hybrid retrieval when `DATABASE_URL` is configured
- Domain controls and result feedback when persistent storage is available
- JSON and CSV result export

## Runtime model

Each search creates one structured intent plan. The same plan controls automatic lens
routing, multi-engine query variants, local and optional Cloudflare reranking, snippet
filtering, and destination-page evidence review. Requirements are modeled as concept
groups, so true equivalents such as “occupational health” and “occupational medicine”
can match without giving partial credit to an unrelated page containing only the word
“occupational.”

The first search response returns ranked discovery results immediately. Destination-page
validation then updates those cards in place through `/api/search/validate`. Sites that
block automated validation remain visible and clearly marked instead of disappearing;
dead, generic, and irrelevant pages move into review buckets. If validation fails or
times out, the initial ranked results remain usable.

The app starts with three configured managed providers and uses the remaining configured
providers only when the first pass is sparse. It rotates through separately configured
keys after authentication, quota, or rate-limit failures, and reports each provider's
real state in search diagnostics. Direct public-engine HTML retrieval is disabled by
default because markup and bot defenses are not a dependable production search
contract. A self-hosted SearXNG instance remains supported.

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No | PostgreSQL persistence, bookmarks, history, domain preferences, and pgvector retrieval |
| `SEARXNG_URL` | No | Enables the SearXNG source |
| `SERPER_API_KEY` | No | Enables Serper web discovery |
| `EXA_API_KEY` | No | Enables Exa web discovery |
| `LANGSEARCH_API_KEY` | No | Enables LangSearch web discovery |
| `FIRECRAWL_API_KEY` | No | Enables Firecrawl Search discovery; this app does not invoke Firecrawl crawling |
| `OLOSTEP_API_KEY` | No | Enables Olostep Search discovery; this app does not invoke Olostep scraping |
| `*_API_KEYS` or `*_API_KEY_2` … `*_API_KEY_11` | No | Adds provider-specific key rotation without exposing key values |
| `WEBSEARCH_API_KEY` | No | Preserved and reported as unwired until its service endpoint/provider is explicitly identified |
| `GEMINI_API_KEY` | No | Adds bounded semantic intent interpretation and local-language query variants |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | No | Adds bounded semantic reranking |
| `CEREBRAS_API_KEY` | No | Adds destination-page relevance review |
| `GROQ_API_KEY` | No | Adds fallback and disagreement review for destination-page evidence |
| `ENABLE_LOCAL_EMBEDDINGS=true` | No | Enables the local MiniLM embedding model; otherwise hash-based 384-dimensional embeddings are used |
| `ENABLE_OCR=true` | No | Enables Tesseract OCR; disabled by default because it is resource intensive |
| `ENABLE_LEGACY_HTML_SEARCH=true` | No | Explicitly re-enables the fragile public-engine HTML adapters for local diagnostics |

The app does not expose server environment values to the browser. Settings reads only boolean capability status from `/api/capabilities`.

## Verification

```bash
npm run typecheck
npm run test:settings
npm run build
```

Or run the complete verification command:

```bash
npm run verify
```

Additional database checks:

```bash
npm run check:pgvector
npm run smoke:pgvector
```

## Render deployment

Create a Web Service connected to this repository with:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Node version:** 22
- **Health endpoint:** `/api/health`

Add the optional environment variables above in the Render service settings. Each push to `main` can then deploy automatically.

## Stack

- Next.js 16 App Router
- React 19 and TypeScript
- Tailwind CSS
- Cheerio
- pdf-parse
- Mammoth
- Tesseract.js
- PostgreSQL and pgvector
- Radix UI primitives

## License

MIT
