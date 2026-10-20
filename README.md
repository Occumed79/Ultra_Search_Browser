# Ultra Search Browser

Ultra Search Browser is an Occu-Med procurement intelligence layer over live web search. It is **not** a standalone search index. Neon/PostgreSQL is used for persistence, bookmarks, feedback, and pursuit learning; discovery comes from live search sources.

The application remains usable without paid search credentials: private SearXNG plus the bounded direct-engine fallback provide a zero-key path. When renewable search API keys are configured, those providers join the normal live discovery fan-out. **SearXNG, Keenable, TinyFish, Tavily, Exa, and LangSearch participate in the live discovery architecture when configured.**

## Core architecture

```text
User request
    ↓
Generic query planner + Neon buyer-term suggestions
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
Generic query evidence gate; canonical Neon relevance after page validation
    ↓
Deep destination-page / document / lifecycle validation
    ↓
Optional Cerebras → Groq post-validation evidence review
    ↓
SHOW / REVIEW / REJECT
    ↓
Optional Cloudflare semantic reranking of verified SHOW matches only
    ↓
Neon/PostgreSQL persistence, bookmarks, feedback, pursuit learning
```

**Google, Google CSE, Bing, and DuckDuckGo are not rescue-only sources.** Ultra Search explicitly requests them as part of its normal SearXNG engine ensemble. The separate direct Google/DuckDuckGo/Bing rescue pass is an additional fallback transport used only when aggregate primary coverage is unexpectedly sparse.

## Source-backed procurement status verification

For live procurement searches, **Neon OCCU_MED_AWARE relevance scores are distinct from source-backed verification**. A canonical SHOW candidate is now checked against the original public issuing portal before it can receive the green verified badge.

The integration uses original MIT-licensed source code from [@cliwant/mcp-sam-gov](https://github.com/cliwant/mcp-sam-gov) (v1.17.0), copied with upstream license and minimal Next.js import-path compatibility edits under `src/vendor/cliwant`. Ultra Search adds only an adapter, not a new procurement crawler:
- **OpenGov:** Exact `/portal/:governmentCode/projects/:id` lookup using the existing OpenGov public project-list client. The source's `status=open` and a future `proposalDeadline` are required.
- **Bonfire:** Exact original opportunity URL match in the issuing organization's active-opportunities RSS feed. Title similarity is not an identity match.
- **SAM.gov:** Exact 32-hex notice ID using the upstream `SamGovClient`. Requires `active=Yes`, an eligible notice type, and a future response deadline. The existing Render `SAM_GOV_API_KEY` is read on the server only.

**Unsupported local-government portals, third-party aggregators (including HigherGov), inaccessible records, unknown deadlines, source errors, and candidates beyond the bounded lookup budget go to Needs verification**, not to green Verified. Official closed, awarded, or cancelled statuses override an earlier future-date guess and move the record to Expired/Closed. Real opportunities from other portals can therefore be found as research leads while they await a source adapter; they are not deleted.

The source connectors have bounded lookups and fail conservatively. The application retains its existing discovery providers, OCR.space, Cloudflare ranking (applied after the new gate), and `OCCU_MED_AWARE` service relevance rules. Synthetic `testMode` leaves third-party calls disabled. Existing saved records may need revalidation before being labeled confirmed.

The source-link enhancement also examines **explicitly labeled original/official record hyperlinks** extracted from third-party procurement pages. The link must point to a recognized exact OpenGov project, Bonfire opportunity, or SAM.gov notice, and the primary-source result must independently corroborate the listing using a strong solicitation number plus title, or independently agreeing title and buyer. A link to an unrelated open bid cannot promote a result. At most two original-source links are examined per candidate, with existing server-side lookup budgets.

The review queue displays the source verification reason, and verified cards provide a separate **View original notice** link when found on an intermediary site. Date-only source deadlines remain eligible through their UTC calendar date; precise source deadlines retain their own timestamps. SAM.gov presolicitations, sources-sought, and other non-offer notice types cannot be labeled open solicitations merely because they are active and dated in the future.

This integration still does not treat search-engine summaries, guessed source URLs, a numerical fit score, or third-party future dates as procurement verification. Wider official-source coverage should be added by integrating published connectors and running issuer-specific regression tests, not by inflating relevance scores or automatically interpreting any future date as an open deadline.

## OCR.space recovery for public procurement PDFs

If `ENABLE_OCR_SPACE=true` and the existing `OCR_API_KEY`, `OCR_API_KEY_2`, and `OCR_API_KEY_3` are set in Render, Ultra Search can recover text from **publicly accessible solicitation PDFs** that contain too little selectable text. A server-side PDF validation fetch must succeed first; documents are uploaded as PDF bytes to OCR.space using a POST header, **never by passing a sensitive source URL**. Private files, local documents, medical records, and non-procurement searches are excluded.

The OCR.space free tier currently restricts each call to **1 MB** and **3 PDF pages**. Longer and larger PDFs are not sent to OCR.space. Existing local OCR remains an optional fallback when `ENABLE_OCR=true` and the PDF rasterizer is installed. OCR failure never validates or promotes a solicitation without substantive evidence.

The three keys form a rotating pool: each key starts a subsequent request, a quota/authentication error blocks that account for the remainder of the *UTC* usage day, and failures try the next key within the bounded request timeout. Requests and successes are tracked in the application-owned Neon `ultra_search_ocr_key_usage` table by **SHA-256 key fingerprint**, not by plaintext key. Reservations are atomic across app instances and never exceed the local ceiling of **500 attempts per key per UTC day**; if the Neon accounting ledger is unavailable, external OCR fails closed. Provider-side anti-abuse and rate restrictions may be stricter, and the provider's actual reset time may differ from UTC; counts reset logically on the next UTC calendar day, not on app restart. Failed/timeout submissions count conservatively toward usage.

API keys must be rotated if previously shared in screenshots. This integration does not use or alter any other provider's API keys.

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
- Expands queries using generic procurement mechanics and buyer terms loaded from Neon.
- Builds broad, official-source, direct-document, procurement-portal, freshness, and capability-specific query variants.
- Fans those variants across independent live search sources.
- Measures retrieval coverage using canonical distinct destinations and query diversity rather than raw result count.
- Merges and deduplicates cross-query / cross-engine / cross-provider candidates.
- Rejects generic pages, jobs, definitions, unrelated patient care, marketing noise, expired notices, and other known junk patterns.
- Loads the shared OCCU_MED_AWARE profile; no local capability vocabulary, historical seeds, exclusions, or fit thresholds. Generic feedback changes order only.
- Opens promising destination pages and supported documents for evidence review.
- Detects solicitation identity, lifecycle, due dates, amendments, attachments, and duplicate opportunities.
- Sends scanned/image-only procurement documents and thin client-rendered procurement portals to REVIEW instead of falsely calling them junk.
- Applies the mandatory SHOW / REVIEW / REJECT decision gate.
- Stores bookmarks, feedback, and pursuit learning in Neon/PostgreSQL when configured; persistence is bounded and fail-open.

## Search lifecycle

### 1. Plan

`POST /api/search/plan` creates the generic procurement query plan.

### 2. Retrieve

The website calls `POST /api/search`. The server executes the plan across SearXNG plus every configured live discovery provider. If aggregate primary coverage is sparse, Ultra Search can invoke a bounded direct Google/DuckDuckGo/Bing fallback.

Search-provider API keys are optional accelerators, not a requirement for the application to function.

### 3. Ingest and filter

`POST /api/search/ingest` applies:

- URL cleanup and tracking-parameter removal
- cross-query / cross-engine / cross-provider deduplication
- procurement intent gate
- generic query evidence filter
- exclusions loaded from the canonical profile
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
| `OCCU_MED_AWARE_DATABASE_URL` | For relevance | Existing Insight-Hub Neon profile; set in Render environment variables |
| `RELEVANCE_PROFILE_CACHE_PATH` | No | Runtime-only signed last-known-good profile cache |
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

Production smoke checks deployment identity, generic planning, multi-source retrieval, evidence validation, and non-persistence of synthetic evidence. Live canary queries are operator-configurable, rather than a locked capability matrix.

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