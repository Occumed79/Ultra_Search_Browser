from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected patch target missing in {path}: {old[:200]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "src/lib/search-orchestrator.ts",
    "import { expandQuery, scoreSignals } from './intelligence'",
    """import {
  geminiGroundedSearchCapabilities,
  searchGeminiGroundedWeb,
  type GeminiGroundedSearchDiagnostics,
} from './gemini-grounded-search'
import { expandQuery, scoreSignals } from './intelligence'""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    "purpose: QueryPurpose | 'managed-api' | 'memory' | 'small-web'",
    "purpose: QueryPurpose | 'managed-api' | 'gemini-grounded' | 'memory' | 'small-web'",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """  cloudflareRerank: CloudflareRerankDiagnostics
  managedSearch: ManagedSearchDiagnostics
  legacyHtmlSearchEnabled: boolean""",
    """  cloudflareRerank: CloudflareRerankDiagnostics
  managedSearch: ManagedSearchDiagnostics
  geminiGroundedSearch: GeminiGroundedSearchDiagnostics
  legacyHtmlSearchEnabled: boolean""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """  const [liveSettled, managedSearch, memoryKeyword, memoryVector, smallWebEntries, marginalia] = await Promise.all([
    livePromise,
    managedPromise,
    keywordPromise,
    vectorPromise,
    smallWebPromise,
    marginaliaPromise,
  ])

  const occurrences = new Map<string, Occurrence>()""",
    """  const [liveSettled, managedSearch, memoryKeyword, memoryVector, smallWebEntries, marginalia] = await Promise.all([
    livePromise,
    managedPromise,
    keywordPromise,
    vectorPromise,
    smallWebPromise,
    marginaliaPromise,
  ])
  const geminiGroundedSearch = managedSearch.results.length === 0
    ? await searchGeminiGroundedWeb(normalizedQuery, lens)
    : {
        text: '',
        results: [] as ScrapedResult[],
        diagnostics: {
          ...geminiGroundedSearchCapabilities(),
          attempted: false,
          successful: false,
          resultCount: 0,
          runtimeMs: 0,
          searchQueries: [],
        },
      }

  const occurrences = new Map<string, Occurrence>()""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """  for (const result of managedSearch.results) {
    const query = result.retrieval?.queries[0] || normalizedQuery
    addResults(occurrences, [result], result.source, query, 'semantic')
  }
  for (const attempt of managedSearch.diagnostics.attempts) {""",
    """  for (const result of managedSearch.results) {
    const query = result.retrieval?.queries[0] || normalizedQuery
    addResults(occurrences, [result], result.source, query, 'semantic')
  }
  for (const result of geminiGroundedSearch.results) {
    addResults(occurrences, [result], result.source, normalizedQuery, 'semantic')
  }
  if (geminiGroundedSearch.diagnostics.attempted) {
    const groundedStatus = geminiGroundedSearch.diagnostics.successful
      ? 'success'
      : geminiGroundedSearch.diagnostics.error
        ? 'failed'
        : 'empty'
    sourceRuns.push({
      source: 'gemini-google-search',
      query: normalizedQuery,
      purpose: 'gemini-grounded',
      status: groundedStatus,
      resultCount: geminiGroundedSearch.diagnostics.resultCount,
      runtimeMs: geminiGroundedSearch.diagnostics.runtimeMs,
      error: geminiGroundedSearch.diagnostics.error,
    })
    if (groundedStatus === 'failed') {
      failures.push(`gemini-google-search: ${geminiGroundedSearch.diagnostics.error || 'grounded search failed'}`)
    }
  }
  if (geminiGroundedSearch.results.length > 0) {
    sourceLabels.add('Gemini Google Search · grounded-api')
    if (geminiGroundedSearch.text.trim()) rawTexts.push(geminiGroundedSearch.text)
  }
  for (const attempt of managedSearch.diagnostics.attempts) {""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    "if (!managedCapabilities.configured && legacyTasks.length === 0) {",
    "if (!managedCapabilities.configured && legacyTasks.length === 0 && !geminiGroundedSearch.diagnostics.configured) {",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """      attemptedLiveTasks: legacyTasks.length + managedSearch.diagnostics.attemptedRequests,
      successfulLiveTasks: liveSettled.filter(item => item.status === 'fulfilled').length
        + managedSearch.diagnostics.successfulRequests,
      failedLiveTasks: liveSettled.filter(item => item.status === 'rejected').length
        + managedSearch.diagnostics.failedRequests,""",
    """      attemptedLiveTasks: legacyTasks.length
        + managedSearch.diagnostics.attemptedRequests
        + (geminiGroundedSearch.diagnostics.attempted ? 1 : 0),
      successfulLiveTasks: liveSettled.filter(item => item.status === 'fulfilled').length
        + managedSearch.diagnostics.successfulRequests
        + (geminiGroundedSearch.diagnostics.successful ? 1 : 0),
      failedLiveTasks: liveSettled.filter(item => item.status === 'rejected').length
        + managedSearch.diagnostics.failedRequests
        + (geminiGroundedSearch.diagnostics.attempted && !geminiGroundedSearch.diagnostics.successful ? 1 : 0),""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """      cloudflareRerank: cloudflare.diagnostics,
      managedSearch: managedSearch.diagnostics,
      legacyHtmlSearchEnabled,""",
    """      cloudflareRerank: cloudflare.diagnostics,
      managedSearch: managedSearch.diagnostics,
      geminiGroundedSearch: geminiGroundedSearch.diagnostics,
      legacyHtmlSearchEnabled,""",
)

replace_once(
    "src/app/api/health/route.ts",
    "import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'",
    """import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { geminiGroundedSearchCapabilities } from '../../../lib/gemini-grounded-search'""",
)

replace_once(
    "src/app/api/health/route.ts",
    """  const gemini = semanticIntentCapabilities()
  const cloudflare = cloudflareRerankCapabilities()""",
    """  const gemini = semanticIntentCapabilities()
  const geminiSearch = geminiGroundedSearchCapabilities()
  const cloudflare = cloudflareRerankCapabilities()""",
)

replace_once(
    "src/app/api/health/route.ts",
    "searchPipeline: 'orchestrated-v8-multi-api-failover'",
    "searchPipeline: 'orchestrated-v9-gemini-grounded-fallback'",
)

replace_once(
    "src/app/api/health/route.ts",
    """      geminiIntentPlanner: gemini.configured,
      geminiIntentModel: gemini.model,
      structuredIntentPlanning: true,""",
    """      geminiIntentPlanner: gemini.configured,
      geminiIntentModel: gemini.model,
      geminiGroundedSearch: geminiSearch.configured,
      geminiGroundedSearchModel: geminiSearch.model,
      structuredIntentPlanning: true,""",
)

replace_once(
    "src/app/api/search/route.ts",
    """      ...orchestration.diagnostics.managedSearch.configuredProviders,
      ...(orchestration.diagnostics.legacyHtmlSearchEnabled""",
    """      ...orchestration.diagnostics.managedSearch.configuredProviders,
      ...(orchestration.diagnostics.geminiGroundedSearch.configured ? ['gemini-google-search'] : []),
      ...(orchestration.diagnostics.legacyHtmlSearchEnabled""",
)

replace_once(
    "src/app/page.tsx",
    """  SearXNG: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  'memory-vector':""",
    """  SearXNG: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  'Gemini Google Search': 'bg-cyan-500/10 text-cyan-200 border-cyan-500/30',
  'memory-vector':""",
)

replace_once(
    "scripts/production-smoke.mjs",
    "health.searchPipeline === 'orchestrated-v8-multi-api-failover'",
    "health.searchPipeline === 'orchestrated-v9-gemini-grounded-fallback'",
)
