# Canonical Neon relevance cleanup

Branch: `cleanup/remove-built-in-occumed-relevance`

Base commit: `b59089f0ea4d38bdb5bee615a905328ffdd36a58`

Ultra Search now reads the existing Insight-Hub profile from `OCCU_MED_AWARE_DATABASE_URL`. The loader uses the same canonical SQL, completeness checks, row hash, rule interpreter, decision layer and signed runtime-cache format. No database, schema, seed migration or embedded vocabulary is created.

Local capability lists, buyer-sector aliases/bonuses, historical seeds, NAICS lists, service regexes, exclusion lists, fit weights and numeric fit cutoffs have been removed. Evidence is interpreted against the loaded profile; full and partial evidence are represented using its accept/review floors. This adapter deliberately does not port Insight-Hub’s numeric scoring weights or source-domain exclusion list into another local scoring engine. Generic retrieval and query ranking never set the canonical verdict.

All tracked paths were inventoried and recursively searched, including root files, `.github`, docs, public, scripts, all `src/app` and API directories, components, hooks, lib, types, and nested directories. Remaining Occu-Med references are branding, the existing database schema/connection/cache identifiers, canonical-rule descriptions and test sample prose. Generic procurement-source catalogs, page-type vocabulary and user-supplied query constraints remain retrieval/evidence machinery; they do not define Occu-Med relevance. No remaining hard-coded Occu-Med relevance authority was found.

When the live profile cannot load, a verified last-known-good cache may be used. With no available profile, relevance is REVIEW; relevance-based pruning refuses to delete records. Generic lifecycle/page failures remain independent. Query planning, provider routing, SearXNG, Keenable, TinyFish, Tavily, Exa, LangSearch, extraction, recovery, provenance, lifecycle/date checks, dedupe, persistence, caching and existing UI flows remain in place.

Validation:

- `npm run typecheck`: passed.
- `npm run test:search`: 199 tests passed, 0 failed, 0 skipped.
- `RUNTIME_IMPORT_AUDIT_STRICT=1 node scripts/runtime-import-audit.mjs`: passed; 100/100 source modules reachable, no unresolved local imports.
- `git diff --check`: passed.
- Focused coverage: injected Neon rows and SQL, profile changes, thresholds/rules/codes, source-independent verdicts, outage/cache integrity, safe pruning, generic retrieval, profile-derived query aliases, page extraction, lifecycle/date behavior, and dedupe.
- Live Neon authentication was not tested in this workspace because no connection URL is configured. Add the existing profile URL to Render as `OCCU_MED_AWARE_DATABASE_URL`.
- No build, deployment or merge performed.

File inventory: 13 added, 52 modified, 15 deleted (80 total).

| Status | File |
| --- | --- |
| Modified | `.env.example` |
| Modified | `.github/workflows/nuclear-hardening-final.yml` |
| Modified | `.gitignore` |
| Modified | `HARDENING.md` |
| Modified | `README.md` |
| Added | `docs/canonical-relevance-cleanup.md` |
| Deleted | `docs/occumed-verified-award-patterns.md` |
| Modified | `public/search-validation-evidence.txt` |
| Deleted | `scripts/buyer-language-family-regression.test.ts` |
| Added | `scripts/canonical-neon-relevance.test.ts` |
| Modified | `scripts/domain-memory-hardening.test.ts` |
| Modified | `scripts/e2e-desktop-browser.mjs` |
| Deleted | `scripts/employment-evaluation-search-regression.test.ts` |
| Modified | `scripts/external-review-opt-in.test.ts` |
| Added | `scripts/fixtures/canonical-profile.ts` |
| Deleted | `scripts/fixtures/occumed-golden-benchmark.json` |
| Modified | `scripts/intent-understanding.test.ts` |
| Deleted | `scripts/occumed-golden-benchmark.test.ts` |
| Deleted | `scripts/occumed-result-decision.test.ts` |
| Deleted | `scripts/occumed-verified-awards.test.ts` |
| Modified | `scripts/procurement-negation-hardening.test.ts` |
| Modified | `scripts/production-smoke.mjs` |
| Modified | `scripts/production-user-flow-smoke-contract.test.ts` |
| Modified | `scripts/production-user-flow-smoke.mjs` |
| Modified | `scripts/rfp-intelligence-v4.test.ts` |
| Deleted | `scripts/rfp-quality-benchmark.test.ts` |
| Modified | `scripts/search-intent-quality.test.ts` |
| Modified | `scripts/smart-filter.test.ts` |
| Deleted | `scripts/supplemental-rfp-search.test.ts` |
| Modified | `scripts/verified-completion-fail-open.test.ts` |
| Modified | `scripts/zero-result-procurement-recall.test.ts` |
| Modified | `src/app/api/capabilities/route.ts` |
| Modified | `src/app/api/health/route.ts` |
| Added | `src/app/api/relevance/terms/route.ts` |
| Modified | `src/app/api/search/ingest/route.ts` |
| Modified | `src/app/api/search/plan/route.ts` |
| Modified | `src/app/api/search/route.ts` |
| Modified | `src/app/api/search/validate/route.ts` |
| Modified | `src/app/page.tsx` |
| Modified | `src/app/rfp-decision-gate.css` |
| Modified | `src/app/settings/page.tsx` |
| Modified | `src/components/buyer-terms-dropdown.tsx` |
| Modified | `src/hooks/use-search.ts` |
| Modified | `src/lib/browser-search-bridge.ts` |
| Modified | `src/lib/browser-search-pipeline.ts` |
| Added | `src/lib/canonical-relevance.ts` |
| Added | `src/lib/canonical-result-decision.ts` |
| Added | `src/lib/canonical/occumedAware/db.ts` |
| Added | `src/lib/canonical/occumedAware/relevanceProfileCache.ts` |
| Added | `src/lib/canonical/occumedAware/relevanceProfileLoader.ts` |
| Added | `src/lib/canonical/search/profileRules.ts` |
| Added | `src/lib/canonical/search/relevance.ts` |
| Added | `src/lib/canonical/search/relevanceDecision.ts` |
| Added | `src/lib/canonical/search/relevanceProfile.ts` |
| Modified | `src/lib/deep-validation.ts` |
| Modified | `src/lib/document-extraction.ts` |
| Modified | `src/lib/entity-extraction.ts` |
| Modified | `src/lib/federal-register-index.ts` |
| Modified | `src/lib/index-prune.ts` |
| Modified | `src/lib/intelligence.ts` |
| Modified | `src/lib/intent-relevance.ts` |
| Deleted | `src/lib/occumed-capability-matching.ts` |
| Deleted | `src/lib/occumed-historical-pursuits.ts` |
| Deleted | `src/lib/occumed-index-filters.ts` |
| Deleted | `src/lib/occumed-result-decision.ts` |
| Deleted | `src/lib/occumed-rfp-profile.ts` |
| Deleted | `src/lib/occumed-smart-filter.ts` |
| Modified | `src/lib/page-validation.ts` |
| Modified | `src/lib/procurement-rescue-queries.ts` |
| Modified | `src/lib/rfp-opportunity-intelligence.ts` |
| Modified | `src/lib/sam-gov-index.ts` |
| Modified | `src/lib/search-candidate-processing.ts` |
| Modified | `src/lib/search-intent-gate.ts` |
| Modified | `src/lib/search-planner.ts` |
| Modified | `src/lib/search.ts` |
| Modified | `src/lib/semantic-intent.ts` |
| Modified | `src/lib/smart-filter.ts` |
| Modified | `src/lib/verticals/index.ts` |
| Modified | `src/lib/verticals/pricing/extract.ts` |
| Modified | `src/types/search.ts` |
