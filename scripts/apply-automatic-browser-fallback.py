from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected patch target missing in {path}: {old[:220]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "src/lib/search-orchestrator.ts",
    """const TASK_TIMEOUT_MS = 3_500
const MEMORY_TIMEOUT_MS = 4_000
const OPTIONAL_SOURCE_TIMEOUT_MS = 3_500""",
    """const TASK_TIMEOUT_MS = 3_500
const MEMORY_TIMEOUT_MS = 4_000
const OPTIONAL_SOURCE_TIMEOUT_MS = 3_500
const AUTOMATIC_BROWSER_FALLBACK_SOURCES = new Set<LiveSearchSource>([
  'bing',
  'duckduckgo',
  'mojeek',
])

export function selectAutomaticBrowserFallbackTasks(
  tasks: RetrievalTask[],
  enabled: boolean
): RetrievalTask[] {
  if (!enabled) return []
  const selectedSources = new Set<LiveSearchSource>()
  return tasks.filter(task => {
    if (task.purpose !== 'broad') return false
    if (!AUTOMATIC_BROWSER_FALLBACK_SOURCES.has(task.source)) return false
    if (selectedSources.has(task.source)) return false
    selectedSources.add(task.source)
    return true
  }).slice(0, AUTOMATIC_BROWSER_FALLBACK_SOURCES.size)
}""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """  geminiGroundedSearch: GeminiGroundedSearchDiagnostics
  legacyHtmlSearchEnabled: boolean
  sourceRuns: SourceRunDiagnostic[]""",
    """  geminiGroundedSearch: GeminiGroundedSearchDiagnostics
  legacyHtmlSearchEnabled: boolean
  automaticBrowserFallbackEnabled: boolean
  sourceRuns: SourceRunDiagnostic[]""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """  const managedCapabilities = managedSearchCapabilities()
  const legacyHtmlSearchEnabled = process.env.ENABLE_LEGACY_HTML_SEARCH === 'true'
  const legacyTasks = orchestration.tasks.filter(task =>
    task.source === 'searxng' || legacyHtmlSearchEnabled
  )""",
    """  const managedCapabilities = managedSearchCapabilities()
  const legacyHtmlSearchEnabled = process.env.ENABLE_LEGACY_HTML_SEARCH === 'true'
  const automaticBrowserFallbackEnabled = !managedCapabilities.configured
  const automaticBrowserTasks = selectAutomaticBrowserFallbackTasks(
    orchestration.tasks,
    automaticBrowserFallbackEnabled
  )
  const legacyTasks = orchestration.tasks.filter(task =>
    task.source === 'searxng'
    || legacyHtmlSearchEnabled
    || automaticBrowserTasks.includes(task)
  )""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """  const geminiGroundedSearch = managedSearch.results.length === 0
    ? await searchGeminiGroundedWeb(normalizedQuery, lens)""",
    """  const liveResultCount = liveSettled.reduce(
    (total, item) => total + (item.status === 'fulfilled' ? item.value.data.results.length : 0),
    0
  )
  const geminiGroundedSearch = managedSearch.results.length === 0 && liveResultCount === 0
    ? await searchGeminiGroundedWeb(normalizedQuery, lens)""",
)

replace_once(
    "src/lib/search-orchestrator.ts",
    """      geminiGroundedSearch: geminiGroundedSearch.diagnostics,
      legacyHtmlSearchEnabled,
      sourceRuns,""",
    """      geminiGroundedSearch: geminiGroundedSearch.diagnostics,
      legacyHtmlSearchEnabled,
      automaticBrowserFallbackEnabled,
      sourceRuns,""",
)

replace_once(
    "src/app/api/health/route.ts",
    "searchPipeline: 'orchestrated-v9-gemini-grounded-fallback'",
    "searchPipeline: 'orchestrated-v10-browser-search-fallback'",
)

replace_once(
    "src/app/api/health/route.ts",
    """      managedSearchProviders: managedSearch.providers,
      configuredButUnwiredSearchKeys: managedSearch.configuredButUnwired,
      legacyHtmlSearch:""",
    """      managedSearchProviders: managedSearch.providers,
      configuredButUnwiredSearchKeys: managedSearch.configuredButUnwired,
      automaticBrowserSearchFallback: true,
      automaticBrowserSearchSources: ['bing-rss', 'duckduckgo-lite', 'mojeek'],
      legacyHtmlSearch:""",
)

replace_once(
    "src/app/api/search/route.ts",
    """      ...(orchestration.diagnostics.geminiGroundedSearch.configured ? ['gemini-google-search'] : []),
      ...(orchestration.diagnostics.legacyHtmlSearchEnabled""",
    """      ...(orchestration.diagnostics.geminiGroundedSearch.configured ? ['gemini-google-search'] : []),
      ...(orchestration.diagnostics.automaticBrowserFallbackEnabled
        ? ['bing-rss', 'duckduckgo-lite', 'mojeek']
        : []),
      ...(orchestration.diagnostics.legacyHtmlSearchEnabled""",
)

replace_once(
    "scripts/production-smoke.mjs",
    "health.searchPipeline === 'orchestrated-v9-gemini-grounded-fallback'",
    "health.searchPipeline === 'orchestrated-v10-browser-search-fallback'",
)
