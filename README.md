# Ultra Search Browser

Ultra Search Browser is a focused research search app that combines multiple public web engines, query expansion, lens-aware ranking, asynchronous document enrichment, optional PostgreSQL search memory, and adapter-backed procurement intelligence from Insight Hub.

## What is live

- Multi-engine search through Google, Bing, and DuckDuckGo scraping
- Optional self-hosted SearXNG source
- Optional Insight Hub source for adapter-collected actionable procurement opportunities
- Web, PDF, Government, Procurement, Pricing, Provider, Technical, News, Legal, Medical, Academic, and Financial lenses
- Query expansion and lens-specific ranking signals
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

The first search response is intentionally fast. Advanced extraction and intelligence work runs through `/api/search/enrich`; enriched results replace the initial cards when the request completes. If enrichment fails or times out, the initial results remain usable.

Public search engines may rate-limit or change their HTML. The app keeps successful engine results when another selected source fails. For the most stable independent metasearch path, configure a self-hosted SearXNG instance.

For Procurement searches, `INSIGHT_HUB_API_URL` adds Insight Hub's adapter-fed actionable opportunity inventory as one candidate source. Those records are blended with live-web results and must compete on relevance; they are not automatically placed first.

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
| `INSIGHT_HUB_API_URL` | No | Enables adapter-backed actionable procurement results from the deployed Insight Hub API; use the service origin, with or without `/api` |
| `ENABLE_LOCAL_EMBEDDINGS=true` | No | Enables the local MiniLM embedding model; otherwise hash-based 384-dimensional embeddings are used |
| `ENABLE_OCR=true` | No | Enables Tesseract OCR; disabled by default because it is resource intensive |

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
