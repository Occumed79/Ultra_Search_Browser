# Ultra Search hardening contract

Ultra Search is an internal Occu-Med procurement intelligence application. Core search must remain website-only, zero-search-key, evidence-first, and fail-open around optional persistence or enrichment.

## Required runtime contract

- Website-only search; no browser extension or local client download.
- Private SearXNG is preferred retrieval; bounded Google/DuckDuckGo/Bing rescue is fallback only.
- Core retrieval requires no search API key.
- Search candidates must pass procurement shape and Occu-Med capability gates before deep validation.
- `SHOW` requires affirmative procurement evidence, confirmed active/open lifecycle, confirmed Occu-Med capability fit, and no hard exclusion.
- Unreadable, blocked, login-gated, scanned, or client-rendered procurement evidence may become `REVIEW`; uncertainty must never become `SHOW`.
- Expired, closed, cancelled, awarded, stale, dead, generic, and clearly irrelevant results never enter the primary list.
- Optional database, feedback, semantic review, OCR, and headless recovery failures must not hold the evidence decision path hostage.

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

The canary may accept a clean zero when upstream zero-key sources return no real procurement evidence. It must never manufacture or leak provider/clinic pages into the procurement list.

### Evidence recovery

- Embedded JSON/JSON-LD/Next/Nuxt application state is inspected before a thin client shell is rejected.
- Optional headless Chromium recovery is explicit opt-in, one process at a time, rate-limited, time-bounded, output-bounded, and public-URL-only.
- Optional scanned-PDF OCR is page-count, DPI, worker, time, and temporary-file bounded.
- Recovery failure is REVIEW, not SHOW.

### Retrieval health and flight recorder

- SearXNG and direct rescue sources maintain bounded rolling latency/failure state.
- Three consecutive transport failures temporarily open a circuit; successful half-open retries recover the source.
- One search trace records planner, retrieval, ingest, and validation stages with counts/timings/decisions while stripping secret-shaped and extracted-content fields.
- Flight-recorder retention is bounded to 100 process-local traces with a one-hour TTL.

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
