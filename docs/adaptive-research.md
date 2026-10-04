# Adaptive procurement research

The existing 12-query manual sweep remains wave one. `/api/search/validate` now inspects its completed page/package evidence, then runs up to two evidence-driven retrieval/validation waves before final feedback ranking and persistence. The homepage opts in even when initial filtering returns no display candidates. Existing API clients can opt out with `research: false`; synthetic production validation always skips follow-up discovery.

The planner uses structured procurement identities and checked destinations, not arbitrary page words. It can follow exact solicitation titles/numbers, buyer domains, linked portal hosts and document titles. Checked inaccessible portals can generate site searches using the user's query, but thin/blocked text does not count as evidence or novelty.

Coverage gaps include missing state/local coverage when a non-federal-only query has federal results, missing landing pages for direct documents, missing extracted attachments, weak cross-host corroboration, and missing canonical categories explicitly matched by the user query. Canonical categories/aliases are read from the existing Neon profile. No new vocabulary, relevance rules, relevance score or cutoff is added. Agency/buyer names and provider overlap guide retrieval only.

Limits:

- Three total waves, six distinct follow-up queries per wave.
- Eighteen provider jobs per adaptive wave: at most fifteen primary jobs plus three direct-engine rescue jobs. Every query gets a primary slot, with remaining jobs distributed across configured indexes. Existing provider-internal key rotation and transient retries remain bounded by their existing implementations.
- Sixty total page-validation targets across the loop, at most twelve targets per adaptive wave. Remaining page budget is divided across possible future waves. Candidate URLs already checked are not reopened; follow-ups validate only their bounded fresh selection.
- Follow-ups share the validation endpoint's existing 120-second server / 118-second client envelope, reserving time for final persistence. A slow first wave can consume that envelope, so the loop may intentionally stop before starting a follow-up.
- Normalized queries never repeat across plans. The same query may still fan out across different engines as part of a single provider wave.

After each wave, continuation requires new checked procurement destinations, solicitation identities, SHOW/REVIEW opportunities, buyers/hosts, or extracted package documents. Tracking variants, repeated URLs, junk, unvalidated candidates and expired results do not supply novelty. Low raw result counts are not the continuation rule. A no-evidence first wave may get one gap-driven recovery wave; an unproductive recovery stops.

All new candidates reuse the existing provider health/circuit breakers, normalization, safe page recovery, document/package extraction, date/lifecycle handling, semantic evidence checks, solicitation dedupe and canonical Neon decision gate. Final verified persistence includes retrieval query provenance. Failed follow-up discovery returns the already validated first-wave evidence.

Adaptive queries carry `wave`, `reason`, originating evidence URLs, optional coverage gap and profile version. Reasons are `exact-title-followup`, `solicitation-number-followup`, `buyer-domain-followup`, `portal-followup`, `attachment-followup`, `coverage-gap` and `canonical-service-gap`. They appear in result retrieval metadata, validation diagnostics and the existing flight recorder (`research.wave-start`, `research.wave-complete`, `research.complete`). Final client suggestions include follow-up queries.

The provider executor was extracted to `src/lib/search-retrieval.ts`, preserving `/api/search`'s HTTP contract and the first-wave provider budgets. The generic cache cleanup interval now uses `unref()` so importing retrieval in a finite server worker/test does not keep that worker alive after its work completes.

Validation covers adaptive identities and provenance, coverage gaps, profile-derived aliases, unavailable Neon, query dedupe, provider-call allocation, duplicate/junk stopping, third-wave novelty, budgets/cancellation/failure, cross-wave lifecycle/dedupe, scanned evidence REVIEW, and a mocked transport integration through real providers, page extraction and linked-package validation. Live provider/Neon credentials and deployment are outside these deterministic checks.
