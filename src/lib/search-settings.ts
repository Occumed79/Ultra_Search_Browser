import type { ScrapedResult, SearchLens, SearchSource, UserSettings } from '../types/search'

export const SUPPORTED_SEARCH_SOURCES = ['google', 'bing', 'duckduckgo', 'searxng', 'memory'] as const
export type SupportedSearchSource = (typeof SUPPORTED_SEARCH_SOURCES)[number]
export type LiveSearchSource = Exclude<SupportedSearchSource, 'memory'>

export const RESULT_COUNT_OPTIONS = [10, 20, 40, 60] as const

export const SEARCH_SOURCE_OPTIONS: Array<{ value: SupportedSearchSource; label: string; description: string }> = [
  { value: 'google', label: 'Google', description: 'Google web results' },
  { value: 'bing', label: 'Bing', description: 'Bing web results' },
  { value: 'duckduckgo', label: 'DuckDuckGo', description: 'DuckDuckGo HTML results' },
  { value: 'searxng', label: 'SearXNG', description: 'Configured self-hosted metasearch' },
  { value: 'memory', label: 'Small Web / Memory', description: 'Stored keyword and vector results' },
]

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  defaultSources: ['google', 'bing', 'duckduckgo', 'memory'],
  resultsPerPage: 20,
  autoSummarize: true,
  safeSearch: true,
  openInNewTab: true,
  showFavicons: true,
  showDescriptions: true,
  keyboardShortcuts: true,
  searchDelay: 300,
  preferredLanguage: 'en',
  region: 'us',
  aiModel: 'local-grounded',
}

export interface SearchRequestPreferences {
  defaultSources: SearchSource[]
  resultsPerPage: number
  autoSummarize: boolean
  safeSearch: boolean
  preferredLanguage: string
  region: string
}

export interface SearchPlan {
  liveSources: LiveSearchSource[]
  useMemory: boolean
  resultsPerPage: number
  autoSummarize: boolean
  safeSearch: boolean
  preferredLanguage: string
  region: string
}

export interface SearchJobResult {
  engine: string
  query: string
  data: { text: string; results: ScrapedResult[] }
}

const supportedSourceSet = new Set<string>(SUPPORTED_SEARCH_SOURCES)
const themeSet = new Set(['light', 'dark', 'system', 'oled', 'sepia'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanLocale(value: unknown, fallback: string, length: number): string {
  if (typeof value !== 'string') return fallback
  const cleaned = value.trim().toLowerCase().replace(/[^a-z-]/g, '').slice(0, length)
  return cleaned || fallback
}

function normalizeResultCount(value: unknown): number {
  const requested = typeof value === 'number' && Number.isFinite(value)
    ? Math.min(60, Math.max(10, Math.round(value)))
    : DEFAULT_USER_SETTINGS.resultsPerPage

  return RESULT_COUNT_OPTIONS.reduce((closest, option) =>
    Math.abs(option - requested) < Math.abs(closest - requested) ? option : closest
  , DEFAULT_USER_SETTINGS.resultsPerPage)
}

export function normalizeUserSettings(value: unknown): UserSettings {
  const candidate = asRecord(value)
  const selectedSources = Array.isArray(candidate.defaultSources)
    ? Array.from(new Set(candidate.defaultSources.filter(
        (source): source is SupportedSearchSource => typeof source === 'string' && supportedSourceSet.has(source)
      )))
    : []

  return {
    ...DEFAULT_USER_SETTINGS,
    theme: typeof candidate.theme === 'string' && themeSet.has(candidate.theme)
      ? candidate.theme as UserSettings['theme']
      : DEFAULT_USER_SETTINGS.theme,
    defaultSources: selectedSources.length > 0 ? selectedSources : [...DEFAULT_USER_SETTINGS.defaultSources],
    resultsPerPage: normalizeResultCount(candidate.resultsPerPage),
    autoSummarize: asBoolean(candidate.autoSummarize, DEFAULT_USER_SETTINGS.autoSummarize),
    safeSearch: asBoolean(candidate.safeSearch, DEFAULT_USER_SETTINGS.safeSearch),
    openInNewTab: asBoolean(candidate.openInNewTab, DEFAULT_USER_SETTINGS.openInNewTab),
    showFavicons: asBoolean(candidate.showFavicons, DEFAULT_USER_SETTINGS.showFavicons),
    showDescriptions: asBoolean(candidate.showDescriptions, DEFAULT_USER_SETTINGS.showDescriptions),
    keyboardShortcuts: asBoolean(candidate.keyboardShortcuts, DEFAULT_USER_SETTINGS.keyboardShortcuts),
    searchDelay: typeof candidate.searchDelay === 'number' && Number.isFinite(candidate.searchDelay)
      ? Math.min(2_000, Math.max(0, Math.round(candidate.searchDelay)))
      : DEFAULT_USER_SETTINGS.searchDelay,
    preferredLanguage: cleanLocale(candidate.preferredLanguage, DEFAULT_USER_SETTINGS.preferredLanguage, 12),
    region: cleanLocale(candidate.region, DEFAULT_USER_SETTINGS.region, 8),
    aiModel: typeof candidate.aiModel === 'string' && candidate.aiModel.trim()
      ? candidate.aiModel.trim().slice(0, 80)
      : DEFAULT_USER_SETTINGS.aiModel,
  }
}

export function toSearchRequestPreferences(value: unknown): SearchRequestPreferences {
  const settings = normalizeUserSettings(value)
  return {
    defaultSources: settings.defaultSources,
    resultsPerPage: settings.resultsPerPage,
    autoSummarize: settings.autoSummarize,
    safeSearch: settings.safeSearch,
    preferredLanguage: settings.preferredLanguage,
    region: settings.region,
  }
}

export function buildSearchPlan(value: unknown): SearchPlan {
  const settings = normalizeUserSettings(value)
  const selected = new Set(settings.defaultSources)
  return {
    liveSources: SUPPORTED_SEARCH_SOURCES.filter(
      (source): source is LiveSearchSource => source !== 'memory' && selected.has(source)
    ),
    useMemory: selected.has('memory'),
    resultsPerPage: settings.resultsPerPage,
    autoSummarize: settings.autoSummarize,
    safeSearch: settings.safeSearch,
    preferredLanguage: settings.preferredLanguage,
    region: settings.region,
  }
}

const explicitPattern = /\b(porn|pornography|xxx|nsfw|explicit\s+sex|adult\s+video|escort\s+service)\b/i

export function filterSafeResults(results: ScrapedResult[], safeSearch: boolean): ScrapedResult[] {
  if (!safeSearch) return results
  return results.filter(result => !explicitPattern.test(`${result.title} ${result.description} ${result.url}`))
}

export function collectSettledSearchJobs(settled: PromiseSettledResult<SearchJobResult>[]) {
  const results: ScrapedResult[] = []
  const rawTexts: string[] = []
  const sources: string[] = []
  const failures: string[] = []

  for (const item of settled) {
    if (item.status === 'fulfilled') {
      results.push(...item.value.data.results)
      if (item.value.data.text.trim()) rawTexts.push(item.value.data.text)
      sources.push(`${item.value.engine} (${item.value.query.slice(0, 60)})`)
    } else {
      failures.push(item.reason instanceof Error ? item.reason.message : String(item.reason))
    }
  }

  return { results, rawTexts, sources, failures }
}

export function buildGroundedSummary(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[],
  enabled: boolean
): string | undefined {
  if (!enabled || results.length === 0) return undefined

  const top = results.slice(0, 3)
  const matches = top.map(result => {
    const domain = result.domain || (() => {
      try { return new URL(result.url).hostname.replace(/^www\./, '') } catch { return 'unknown source' }
    })()
    const title = result.title.replace(/\s+/g, ' ').trim().slice(0, 90)
    return `“${title}” (${domain})`
  })
  const sourceCount = new Set(results.map(result => result.source)).size
  return `Found ${results.length} ranked results for “${query}” using the ${lens} lens across ${sourceCount} source${sourceCount === 1 ? '' : 's'}. Highest-ranked matches: ${matches.join('; ')}.`
}
