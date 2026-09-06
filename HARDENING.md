# Ultra Search hardening contract

Ultra Search is an internal Occu-Med procurement intelligence application. Core search must remain website-only, evidence-first, and fail-open around optional persistence or enrichment. The app must also remain usable without paid search credentials through its private SearXNG plus bounded direct-engine fallback path.

## Required runtime contract

- Website-only search; no browser extension or local client download.
- Live retrieval is multi-source: private SearXNG plus every configured renewable provider (Keenable, TinyFish, Tavily, Exa, LangSearch).
- SearXNG primary requests explicitly include Google, Google CSE, Bing, DuckDuckGo, Brave, Startpage, Qwant, Mojeek, and Yahoo unless `SEARXNG_ENGINES` overrides the deployment ensemble.
- Google/Bing/DuckDuckGo are therefore normal primary sources through SearXNG; the separate direct Google/DuckDuckGo/Bing path is fallback only.
- Keenable, Tavily, and Exa support rotating four-key pools with full same-request auth/quota failover when all numbered keys are configured.
- Search-provider API keys are optional; core operation cannot become dependent on them.
- Search candidates must pass procurement shape and Occu-Med capability gates before deep validation.
- `SHOW` requires affirmative procurement evidence, confirmed active/open lifecycle, confirmed Occu-Med capability fit, and no hard exclusion.
- Unreadable, blocked, login-gated, scanned, or client-rendered procurement evidence may become `REVIEW`; uncertainty must never become `SHOW`.
- Expired, closed, cancelled, awarded, stale, dead, generic, and clearly irrelevant results never enter the primary list.
- Optional database, feedback, semantic review, OCR, headless recovery, and individual live-source failures must not hold the evidence decision path hostage.

## Mandatory regression gates

### Real desktop Chromium

The production build is driven in Chromium at 1280×720, 1440×900, and 1920×1080 plus 125% zoom. The gate covers:

- superseding/cancelling an in-flight search;
- a 50-candidate result set;
- SHOW versus REVIEW rendering;
- filters and Clear reset behavior;
- keyboard focus shortcut;
- History, Bookmarks, and Settings navigation contracts;
- long title/URL wrapping;
- horizontal overflow;
- same-origin HTTP failures and browser runtime errors.

### Occu-Med golden benchmark

The locked benchmark contains positive, negative, review, and final-lifecycle cases across occupational medicine, medical surveillance, audiometry/hearing conservation, respirator clearance, drug/alcohol testing, employment examinations, fitness-for-duty, deployment readiness, provider-network, and OCONUS scenarios.

The benchmark must maintain:

- SHOW recall >= 90%;
- zero non-SHOW leakage into SHOW;
- REVIEW safety = 100%;
- REJECT accuracy >= 90%.

### Production canaries

Production verification runs nine real retrieval→ingest capability searches:

1. occupational health services
2. medical surveillance services
3. audiometry hearing conservation services
4. respirator medical clearance services
5. employee medical examinations
6. drug and alcohol testing services
7. deployment medical readiness examinations
8. fitness for duty occupational medicine services
9. OCONUS occupational health services

The canary may accept a clean zero when all available source pools return no real procurement evidence. It must never manufacture or leak provider/clinic pages into the procurement list.

The production transport allow-list must include every transport the live router can emit, including SearXNG-only, Keenable-only, multi-source, direct-rescue, and their combined variants.

### Evidence recovery

- Embedded JSON/JSON-LD/Next/Nuxt application state is inspected before a thin client shell is rejected.
- Optional headless Chromium recovery is explicit opt-in, one process at a time, rate-limited, time-bounded, output-bounded, and public-URL-only.
- Optional scanned-PDF OCR is page-count, DPI, worker, time, and temporary-file bounded.
- Recovery failure is REVIEW, not SHOW.

### Retrieval health and flight recorder

- SearXNG, Keenable, TinyFish, Tavily, Exa, LangSearch, and direct rescue sources maintain independent bounded rolling latency/failure state.
- Three consecutive transport failures temporarily open a circuit; successful half-open retries recover the source.
- Health exposes provider configured state and key counts without exposing credential values.
- SearXNG health exposes the requested primary engine ensemble.
- One search trace records planner, retrieval, ingest, and validation stages with counts/timings/decisions while stripping secret-shaped and extracted-content fields.
- Flight-recorder retention is bounded to 100 process-local traces with a one-hour TTL.

### Renewable provider contracts

- Keenable rotates `KEENABLE_API_KEY` through `KEENABLE_API_KEY_4` and may try all configured slots after retryable auth/quota failures.
- Tavily rotates `TAVILY_API_KEY` through `TAVILY_API_KEY_4` and may try all configured slots after retryable auth/quota failures.
- Exa rotates `EXA_SEARCH_API_KEY` through `EXA_SEARCH_API_KEY_4` and may try all configured slots after retryable auth/quota failures.
- Exa requests evidence-bearing dynamic highlights and caps each call at 10 results to conserve renewable free credit.
- TinyFish uses only its documented search request parameters; undocumented extras must not be added casually.
- One provider returning candidates can never establish authoritative absence from another provider.
- Aggregate live coverage, not any single source, decides whether the bounded direct-engine fallback is needed.

### Semantic review

- Cerebras/Groq are not retrieval engines; they may assist only after deep destination evidence exists.
- Their presence in the environment does not enable them automatically.
- `ENABLE_EXTERNAL_SMART_FILTER=true` is required to activate post-validation external semantic review.
- Health must distinguish “reviewer credential configured” from “external review enabled.”

### Persistence

- Neon/PostgreSQL remains the application persistence layer for history, bookmarks, feedback, verified opportunity memory, and pursuit learning.
- Persistence failures are bounded and fail open.
- Algolia is not part of active search, validation, or persistence.

### Synthetic production evidence

Lifecycle-sensitive synthetic fixtures must not depend on a near-term real calendar date. Their response deadlines must stay sufficiently far in the future that routine passage of time cannot silently convert an OPEN test opportunity into EXPIRED and break deployment verification.

### Load and persistence lifecycle

- Repeated 60-candidate sequential and parallel search processing is soak-tested for result bounds, query isolation, latency, and heap growth.
- Optional PostgreSQL schema is versioned and verified at startup without becoming a core-search dependency.
- Newer incompatible schema, missing required tables, and migration failures are surfaced through health diagnostics rather than silently reported as success.

### Runtime import graph

Every Next runtime entrypoint plus instrumentation/middleware is traced through relative and `@/` TypeScript imports. CI fails on:

- unresolved local imports;
- any new runtime-unreachable source module;
- any quarantined legacy module becoming reachable again.

The nuclear purge physically removes the legacy search-provider architecture proven unreachable by that graph. New dead runtime source is not permitted.