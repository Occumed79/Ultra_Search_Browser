# Search Quality Lab

The Search Quality Lab measures Ultra Search without influencing production ranking.

The benchmark file is **not** a preferred-result list, whitelist, index, or retrieval source. Production search never reads this directory. It exists only to answer questions such as:

- Did the search return results?
- Did the top results cover the concepts in the query?
- Did government and PDF lenses surface the expected source types?
- How many duplicates, stale records, and obvious junk results appeared?
- How diverse were the domains and retrieval sources?
- After human grading, did the most useful results appear near the top?

## Files

- `benchmark.json` — cross-lens evaluation queries and intent expectations.
- `judgments.json` — optional human relevance judgments. It starts empty.
- `src/lib/search-quality.ts` — deterministic metrics including nDCG@10 and reciprocal rank.
- `scripts/search-quality-live.ts` — runs the benchmark against a deployed Ultra Search instance.
- `.github/workflows/search-quality.yml` — manually runs the live evaluation and uploads JSON and Markdown reports.

## Run locally

```bash
npm run quality:test
APP_URL=https://ultra-search-browser.onrender.com npm run quality:live
```

Optional controls:

```bash
QUALITY_LIMIT=8 \
QUALITY_CONCURRENCY=2 \
QUALITY_LENSES=procurement,pdf,government \
APP_URL=https://ultra-search-browser.onrender.com \
npm run quality:live
```

Reports are written to `artifacts/search-quality/`.

## Relevance grades

Human judgments use a 0–3 scale:

| Grade | Meaning |
| ---: | --- |
| 3 | Exact answer or ideal result |
| 2 | Highly useful |
| 1 | Loosely relevant |
| 0 | Irrelevant, stale, duplicate, or junk |

A judgment matches either a domain or URL substring:

```json
{
  "queries": {
    "government-osha-1910-134": [
      { "match": "domain:osha.gov", "grade": 3 },
      { "match": "url:ecfr.gov/current/title-29", "grade": 3 }
    ]
  }
}
```

Judgments affect only evaluation metrics. They never boost, suppress, or inject production search results.

## Live workflow behavior

The GitHub workflow is manual so it does not repeatedly query public engines without a deliberate run. By default, individual engine failures are recorded in the report rather than treated as a ranking regression. Strict mode can be enabled when a fully healthy environment is expected.
