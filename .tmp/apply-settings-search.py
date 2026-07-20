from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected text not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


def write(path: str, content: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)

# Expand the source type without breaking older callers that still reference legacy sources.
replace_once(
    'src/types/search.ts',
    'export type SearchSource = "google" | "bing" | "duckduckgo" | "brave" | "wikipedia" | "github" | "stackoverflow" | "news" | "scholar" | "semantic";',
    'export type SearchSource = "google" | "bing" | "duckduckgo" | "searxng" | "memory" | "brave" | "wikipedia" | "github" | "stackoverflow" | "news" | "scholar" | "semantic";'
)

write('src/lib/search-settings.ts', r'''import type { ScrapedResult, SearchLens, SearchSource, UserSettings } from '../types/search'

export const SUPPORTED_SEARCH_SOURCES = ['google', 'bing', 'duckduckgo', 'searxng', 'memory'] as const
export type SupportedSearchSource = (typeof SUPPORTED_SEARCH_SOURCES)[number]
export type LiveSearchSource = Exclude<SupportedSearchSource, 'memory'>

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

export function normalizeUserSettings(value: unknown): UserSettings {
  const candidate = asRecord(value)
  const selectedSources = Array.isArray(candidate.defaultSources)
    ? Array.from(new Set(candidate.defaultSources.filter(
        (source): source is SupportedSearchSource => typeof source === 'string' && supportedSourceSet.has(source)
      )))
    : []

  const requestedResults = typeof candidate.resultsPerPage === 'number' && Number.isFinite(candidate.resultsPerPage)
    ? Math.round(candidate.resultsPerPage)
    : DEFAULT_USER_SETTINGS.resultsPerPage

  return {
    ...DEFAULT_USER_SETTINGS,
    theme: typeof candidate.theme === 'string' && themeSet.has(candidate.theme)
      ? candidate.theme as UserSettings['theme']
      : DEFAULT_USER_SETTINGS.theme,
    defaultSources: selectedSources.length > 0 ? selectedSources : [...DEFAULT_USER_SETTINGS.defaultSources],
    resultsPerPage: Math.min(60, Math.max(10, requestedResults)),
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
''')

# Search engines accept safe-search and locale settings.
replace_once(
    'src/lib/search.ts',
    "const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'\n",
    "const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'\n\nexport interface SearchEngineOptions {\n  safeSearch?: boolean\n  preferredLanguage?: string\n  region?: string\n}\n"
)
replace_once(
    'src/lib/search.ts',
    "export async function searchDuckDuckGo(query: string): Promise<{ text: string; results: ScrapedResult[] }> {\n  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`\n  const res = await fetchWithTimeout(searchUrl)",
    "export async function searchDuckDuckGo(query: string, options: SearchEngineOptions = {}): Promise<{ text: string; results: ScrapedResult[] }> {\n  const searchUrl = new URL('https://html.duckduckgo.com/html/')\n  searchUrl.searchParams.set('q', query)\n  if (options.safeSearch !== false) searchUrl.searchParams.set('kp', '1')\n  if (options.region) searchUrl.searchParams.set('kl', `${options.region}-${options.preferredLanguage || 'en'}`)\n  const res = await fetchWithTimeout(searchUrl.toString())"
)
replace_once(
    'src/lib/search.ts',
    "export async function searchBingHTML(query: string): Promise<{ text: string; results: ScrapedResult[] }> {\n  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`\n  const res = await fetchWithTimeout(searchUrl)",
    "export async function searchBingHTML(query: string, options: SearchEngineOptions = {}): Promise<{ text: string; results: ScrapedResult[] }> {\n  const searchUrl = new URL('https://www.bing.com/search')\n  searchUrl.searchParams.set('q', query)\n  searchUrl.searchParams.set('count', '20')\n  searchUrl.searchParams.set('adlt', options.safeSearch === false ? 'off' : 'strict')\n  if (options.preferredLanguage) searchUrl.searchParams.set('setlang', options.preferredLanguage)\n  const res = await fetchWithTimeout(searchUrl.toString())"
)
replace_once(
    'src/lib/search.ts',
    "export async function searchGoogleScrape(query: string): Promise<{ text: string; results: ScrapedResult[] }> {\n  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`\n  const res = await fetchWithTimeout(searchUrl)",
    "export async function searchGoogleScrape(query: string, options: SearchEngineOptions = {}): Promise<{ text: string; results: ScrapedResult[] }> {\n  const searchUrl = new URL('https://www.google.com/search')\n  searchUrl.searchParams.set('q', query)\n  searchUrl.searchParams.set('num', '10')\n  searchUrl.searchParams.set('hl', options.preferredLanguage || 'en')\n  if (options.region) searchUrl.searchParams.set('gl', options.region)\n  if (options.safeSearch !== false) searchUrl.searchParams.set('safe', 'active')\n  const res = await fetchWithTimeout(searchUrl.toString())"
)

# SearXNG gets the same safe-search and locale behavior and returns complete ScrapedResult objects.
replace_once(
    'src/lib/searxng.ts',
    "export async function searchSearXNG(query: string): Promise<{ text: string; results: ScrapedResult[] }> {",
    "export async function searchSearXNG(\n  query: string,\n  options: { safeSearch?: boolean; preferredLanguage?: string; region?: string } = {}\n): Promise<{ text: string; results: ScrapedResult[] }> {"
)
replace_once(
    'src/lib/searxng.ts',
    "    url.searchParams.set('engines', 'google,bing,duckduckgo,brave') // Default engines\n",
    "    url.searchParams.set('engines', 'google,bing,duckduckgo,brave')\n    url.searchParams.set('safesearch', options.safeSearch === false ? '0' : '2')\n    if (options.preferredLanguage) url.searchParams.set('language', options.preferredLanguage)\n"
)
replace_once(
    'src/lib/searxng.ts',
    "      description: result.content,\n      source: `searxng-${result.engine}`,\n      rank: index + 1,\n",
    "      description: result.content,\n      domain: (() => { try { return new URL(result.url).hostname.replace(/^www\\./, '') } catch { return '' } })(),\n      source: 'SearXNG',\n      rank: index + 1,\n      score: Number.isFinite(result.score) ? result.score : 0,\n"
)

# Wire selected sources, memory, safe search, result count, and grounded summaries into the live route.
replace_once(
    'src/app/api/search/route.ts',
    "} from '../../../lib/search'\n",
    "} from '../../../lib/search'\nimport { searchSearXNG } from '../../../lib/searxng'\nimport {\n  buildGroundedSummary,\n  buildSearchPlan,\n  collectSettledSearchJobs,\n  filterSafeResults,\n  type LiveSearchSource,\n} from '../../../lib/search-settings'\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "function scoreAndRank(results: ScrapedResult[], lens: SearchLens): ScrapedResult[] {",
    "function scoreAndRank(results: ScrapedResult[], lens: SearchLens, maxResults = MAX_RESULTS): ScrapedResult[] {"
)
replace_once(
    'src/app/api/search/route.ts',
    ".slice(0, MAX_RESULTS)\n",
    ".slice(0, Math.min(MAX_RESULTS, maxResults))\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "    const body = (await request.json()) as { query?: string; lens?: SearchLens }\n",
    "    const body = (await request.json()) as { query?: string; lens?: SearchLens; settings?: unknown }\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "    const expanded = expandQuery(query, lens)\n",
    "    const plan = buildSearchPlan(body.settings)\n    const expanded = expandQuery(query, lens)\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "    const engines = [\n      { name: 'DuckDuckGo', run: searchDuckDuckGo },\n      { name: 'Bing', run: searchBingHTML },\n      { name: 'Google', run: searchGoogleScrape },\n    ]\n",
    "    const engineOptions = {\n      safeSearch: plan.safeSearch,\n      preferredLanguage: plan.preferredLanguage,\n      region: plan.region,\n    }\n    const engineRegistry: Record<LiveSearchSource, { name: string; run: (query: string) => Promise<{ text: string; results: ScrapedResult[] }> }> = {\n      google: { name: 'Google', run: query => searchGoogleScrape(query, engineOptions) },\n      bing: { name: 'Bing', run: query => searchBingHTML(query, engineOptions) },\n      duckduckgo: { name: 'DuckDuckGo', run: query => searchDuckDuckGo(query, engineOptions) },\n      searxng: { name: 'SearXNG', run: query => searchSearXNG(query, engineOptions) },\n    }\n    const engines = plan.liveSources.map(source => engineRegistry[source])\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "    const memoryKeywordPromise = withTimeout(\n      keywordSearchStoredResults(query, lens, undefined, 20),\n      MEMORY_TIMEOUT_MS,\n      'keyword memory search'\n    ).catch(() => [] as ScrapedResult[])\n\n    const memoryVectorPromise = withTimeout(\n      vectorSearchStoredResults(query, lens, 10),\n      MEMORY_TIMEOUT_MS,\n      'vector memory search'\n    ).catch(() => [] as ScrapedResult[])\n",
    "    const memoryKeywordPromise = plan.useMemory\n      ? withTimeout(\n          keywordSearchStoredResults(query, lens, undefined, 20),\n          MEMORY_TIMEOUT_MS,\n          'keyword memory search'\n        ).catch(() => [] as ScrapedResult[])\n      : Promise.resolve([] as ScrapedResult[])\n\n    const memoryVectorPromise = plan.useMemory\n      ? withTimeout(\n          vectorSearchStoredResults(query, lens, 10),\n          MEMORY_TIMEOUT_MS,\n          'vector memory search'\n        ).catch(() => [] as ScrapedResult[])\n      : Promise.resolve([] as ScrapedResult[])\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "    const liveResults: ScrapedResult[] = []\n    const rawTexts: string[] = []\n    const sources: string[] = []\n    const failures: string[] = []\n\n    for (const result of liveSettled) {\n      if (result.status === 'fulfilled') {\n        const { engine, query: engineQuery, data } = result.value\n        liveResults.push(...data.results)\n        if (data.text.trim()) rawTexts.push(data.text)\n        sources.push(`${engine} (${engineQuery.slice(0, 60)})`)\n      } else {\n        failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))\n      }\n    }\n\n    const mergedResults = scoreAndRank(\n      dedupeByUrl([...liveResults, ...memoryKeyword, ...memoryVector]),\n      lens\n    )\n",
    "    const collected = collectSettledSearchJobs(liveSettled)\n    const sources = [...collected.sources]\n    if (memoryKeyword.length > 0) sources.push('Small Web / keyword memory')\n    if (memoryVector.length > 0) sources.push('Small Web / vector memory')\n\n    const mergedResults = scoreAndRank(\n      dedupeByUrl(filterSafeResults(\n        [...collected.results, ...memoryKeyword, ...memoryVector],\n        plan.safeSearch\n      )),\n      lens,\n      plan.resultsPerPage\n    )\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "      rawTexts,\n      failures.length > 0 ? `${failures.length} source requests did not respond in time.` : undefined\n    )\n",
    "      collected.rawTexts,\n      collected.failures.length > 0 ? `${collected.failures.length} source requests did not respond in time.` : undefined\n    )\n    intelligence.summary = buildGroundedSummary(query, lens, mergedResults, plan.autoSummarize)\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "        operators: { candidateQueries, failures },\n",
    "        operators: { candidateQueries, failures: collected.failures, enabledSources: [...plan.liveSources, ...(plan.useMemory ? ['memory'] : [])] },\n"
)
replace_once(
    'src/app/api/search/route.ts',
    "        failedRequests: failures.length,\n",
    "        failedRequests: collected.failures.length,\n        enabledSources: [...plan.liveSources, ...(plan.useMemory ? ['memory'] : [])],\n        safeSearch: plan.safeSearch,\n"
)

# Load settings in the client hook and send only the server-relevant preferences.
replace_once(
    'src/hooks/use-search.ts',
    "import { useCallback, useEffect, useRef, useState } from 'react'\n",
    "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n"
)
replace_once(
    'src/hooks/use-search.ts',
    "  type SearchSuggestion,\n} from '@/types/search'\n",
    "  type SearchSuggestion,\n  type UserSettings,\n} from '@/types/search'\nimport { useLocalStorage } from './use-local-storage'\nimport { DEFAULT_USER_SETTINGS, normalizeUserSettings, toSearchRequestPreferences } from '@/lib/search-settings'\n"
)
replace_once(
    'src/hooks/use-search.ts',
    "  performSearch: () => Promise<void>\n",
    "  performSearch: () => Promise<void>\n  settings: UserSettings\n"
)
replace_once(
    'src/hooks/use-search.ts',
    "export function useSearch(): UseSearchReturn {\n  const [query, setQuery] = useState('')\n",
    "export function useSearch(): UseSearchReturn {\n  const [storedSettings] = useLocalStorage<UserSettings>('user-settings', DEFAULT_USER_SETTINGS)\n  const settings = useMemo(() => normalizeUserSettings(storedSettings), [storedSettings])\n  const [query, setQuery] = useState('')\n"
)
replace_once(
    'src/hooks/use-search.ts',
    "        body: JSON.stringify({ query: searchQuery, lens: searchLens }),\n",
    "        body: JSON.stringify({ query: searchQuery, lens: searchLens, settings: toSearchRequestPreferences(settings) }),\n"
)
replace_once(
    'src/hooks/use-search.ts',
    "  }, [])\n",
    "  }, [settings])\n"
)
replace_once(
    'src/hooks/use-search.ts',
    "    performSearch,\n  }\n",
    "    performSearch,\n    settings,\n  }\n"
)

# Make visible result behavior honor the saved settings.
replace_once(
    'src/app/page.tsx',
    "import type { ScrapedResult, SearchLens } from '../types/search'\n",
    "import type { ScrapedResult, SearchLens, UserSettings } from '../types/search'\n"
)
replace_once(
    'src/app/page.tsx',
    "function SearchResultCard({ result, index }: { result: ResultWithId; index: number }) {",
    "function SearchResultCard({ result, index, settings }: { result: ResultWithId; index: number; settings: UserSettings }) {"
)
replace_once(
    'src/app/page.tsx',
    "        <img\n          src={'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32'}\n          alt=\"\"\n          className=\"mt-0.5 h-5 w-5 flex-shrink-0 rounded opacity-60\"\n          onError={event => {\n            event.currentTarget.style.display = 'none'\n          }}\n        />\n",
    "        {settings.showFavicons && (\n          <img\n            src={'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32'}\n            alt=\"\"\n            className=\"mt-0.5 h-5 w-5 flex-shrink-0 rounded opacity-60\"\n            onError={event => {\n              event.currentTarget.style.display = 'none'\n            }}\n          />\n        )}\n"
)
replace_once(
    'src/app/page.tsx',
    "          <a href={result.url} target=\"_blank\" rel=\"noopener noreferrer\" className=\"block\">",
    "          <a href={result.url} target={settings.openInNewTab ? '_blank' : undefined} rel={settings.openInNewTab ? 'noopener noreferrer' : undefined} className=\"block\">"
)
replace_once(
    'src/app/page.tsx',
    "          {result.description && (\n",
    "          {settings.showDescriptions && result.description && (\n"
)
replace_once(
    'src/app/page.tsx',
    "              target=\"_blank\"\n              rel=\"noopener noreferrer\"\n",
    "              target={settings.openInNewTab ? '_blank' : undefined}\n              rel={settings.openInNewTab ? 'noopener noreferrer' : undefined}\n"
)
replace_once(
    'src/app/page.tsx',
    "    performSearch,\n  } = useSearch()\n",
    "    performSearch,\n    settings,\n  } = useSearch()\n"
)
replace_once(
    'src/app/page.tsx',
    "  useEffect(() => {\n    const handleKeyboard = (event: KeyboardEvent) => {\n",
    "  useEffect(() => {\n    if (!settings.keyboardShortcuts) return\n    const handleKeyboard = (event: KeyboardEvent) => {\n"
)
replace_once(
    'src/app/page.tsx',
    "  }, [])\n\n  const sources = useMemo(\n",
    "  }, [settings.keyboardShortcuts])\n\n  const sources = useMemo(\n"
)
replace_once(
    'src/app/page.tsx',
    "          <kbd className=\"hidden items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/40 sm:flex\">\n            <Command className=\"h-3 w-3\" />K\n          </kbd>\n",
    "          {settings.keyboardShortcuts && (\n            <kbd className=\"hidden items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/40 sm:flex\">\n              <Command className=\"h-3 w-3\" />K\n            </kbd>\n          )}\n"
)
replace_once(
    'src/app/page.tsx',
    "            {intelligence && (\n",
    "            {settings.autoSummarize && intelligence?.summary && (\n"
)
replace_once(
    'src/app/page.tsx',
    "                   {intelligence.summary || 'Results for \"' + intelligence.query + '\" using the ' + intelligence.lens + ' lens.'}\n",
    "                   {intelligence.summary}\n"
)
replace_once(
    'src/app/page.tsx',
    "                 <SearchResultCard key={result.url + '-' + index} result={result} index={index} />\n",
    "                 <SearchResultCard key={result.url + '-' + index} result={result} index={index} settings={settings} />\n"
)

# Replace decorative/unsupported Settings sources with actual runtime sources and preserve normalized settings.
settings_path = Path('src/app/settings/page.tsx')
settings_text = settings_path.read_text()
start = settings_text.index('const defaultSettings: UserSettings = {')
end = settings_text.index('export default function SettingsPage()')
settings_text = settings_text[:start] + settings_text[end:]
settings_text = settings_text.replace(
    'import { UserSettings, SearchSource } from "../../types/search";\n',
    'import { UserSettings, SearchSource } from "../../types/search";\nimport { DEFAULT_USER_SETTINGS, SEARCH_SOURCE_OPTIONS, normalizeUserSettings } from "../../lib/search-settings";\n'
)
settings_text = settings_text.replace(
    '  const [settings, setSettings] = useLocalStorage<UserSettings>("user-settings", defaultSettings);\n',
    '  const [storedSettings, setSettings] = useLocalStorage<UserSettings>("user-settings", DEFAULT_USER_SETTINGS);\n  const settings = normalizeUserSettings(storedSettings);\n'
)
settings_text = settings_text.replace(
    '    setSettings((prev) => ({ ...prev, [key]: value }));\n',
    '    setSettings((prev) => normalizeUserSettings({ ...normalizeUserSettings(prev), [key]: value }));\n'
)
settings_text = settings_text.replace(
    '      const sources = prev.defaultSources.includes(source)\n        ? prev.defaultSources.filter((s) => s !== source)\n        : [...prev.defaultSources, source];\n      return { ...prev, defaultSources: sources };\n',
    '      const normalized = normalizeUserSettings(prev);\n      if (normalized.defaultSources.includes(source) && normalized.defaultSources.length === 1) return normalized;\n      const sources = normalized.defaultSources.includes(source)\n        ? normalized.defaultSources.filter((s) => s !== source)\n        : [...normalized.defaultSources, source];\n      return normalizeUserSettings({ ...normalized, defaultSources: sources });\n'
)
settings_text = settings_text.replace('              {sourceOptions.map((source) => (', '              {SEARCH_SOURCE_OPTIONS.map((source) => (')
settings_text = settings_text.replace(
    '                    onClick={() => setTheme(option.value)}\n',
    '                    onClick={() => {\n                      setTheme(option.value);\n                      updateSetting("theme", option.value as UserSettings["theme"]);\n                    }}\n'
)
settings_text = settings_text.replace(
    "                { key: 'autoSummarize', label: 'Auto-summarize', desc: 'Generate AI summaries for search results' },",
    "                { key: 'autoSummarize', label: 'Auto-summarize', desc: 'Build a summary grounded in returned result titles and domains' },"
)
source_block_end = '''            </div>\n          </div>\n\n          {/* Search Behavior */}'''
replacement = '''            </div>\n            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">\n              <div>\n                <p className="text-[13px] font-medium text-white/80">Results per search</p>\n                <p className="text-[12px] text-white/35">Limit the ranked result set returned by the server</p>\n              </div>\n              <select\n                value={settings.resultsPerPage}\n                onChange={(event) => updateSetting("resultsPerPage", Number(event.target.value))}\n                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white/70"\n              >\n                {[10, 20, 40, 60].map((count) => <option key={count} value={count}>{count}</option>)}\n              </select>\n            </div>\n          </div>\n\n          {/* Search Behavior */}'''
if source_block_end not in settings_text:
    raise SystemExit('Could not locate settings source block end')
settings_text = settings_text.replace(source_block_end, replacement, 1)
settings_path.write_text(settings_text)

# Remove the endpoint that fabricated random source domains. Summaries now come from actual ranked results.
Path('src/app/api/summarize/route.ts').unlink(missing_ok=True)

write('scripts/settings-search.test.ts', r'''import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGroundedSummary,
  buildSearchPlan,
  collectSettledSearchJobs,
  filterSafeResults,
  normalizeUserSettings,
} from '../src/lib/search-settings'
import type { ScrapedResult } from '../src/types/search'

const result = (title: string, url: string, source = 'Google'): ScrapedResult => ({
  title,
  url,
  description: `${title} description`,
  domain: new URL(url).hostname,
  source,
  rank: 1,
  score: 100,
})

test('normalizes persisted settings and removes decorative unsupported sources', () => {
  const settings = normalizeUserSettings({
    defaultSources: ['google', 'wikipedia', 'github', 'memory'],
    resultsPerPage: 999,
    safeSearch: false,
  })
  assert.deepEqual(settings.defaultSources, ['google', 'memory'])
  assert.equal(settings.resultsPerPage, 60)
  assert.equal(settings.safeSearch, false)
})

test('builds an engine plan from the exact selected sources', () => {
  const plan = buildSearchPlan({ defaultSources: ['bing', 'searxng'], safeSearch: true })
  assert.deepEqual(plan.liveSources, ['bing', 'searxng'])
  assert.equal(plan.useMemory, false)
  assert.equal(plan.safeSearch, true)
})

test('keeps successful engine results when an optional source fails', () => {
  const settled: PromiseSettledResult<{ engine: string; query: string; data: { text: string; results: ScrapedResult[] } }>[] = [
    { status: 'fulfilled', value: { engine: 'Bing', query: 'clinic', data: { text: 'clinic result text', results: [result('Clinic', 'https://clinic.example')] } } },
    { status: 'rejected', reason: new Error('SearXNG unavailable') },
  ]
  const collected = collectSettledSearchJobs(settled)
  assert.equal(collected.results.length, 1)
  assert.equal(collected.failures.length, 1)
  assert.match(collected.failures[0], /SearXNG unavailable/)
})

test('safe search removes explicit result metadata while off preserves it', () => {
  const results = [
    result('Occupational medicine clinic', 'https://clinic.example'),
    result('Explicit porn videos', 'https://xxx.example'),
  ]
  assert.equal(filterSafeResults(results, true).length, 1)
  assert.equal(filterSafeResults(results, false).length, 2)
})

test('grounded summaries cite actual ranked titles and domains only when enabled', () => {
  const results = [result('County occupational health bid', 'https://county.gov/bid', 'Bing')]
  const summary = buildGroundedSummary('occupational health bid', 'procurement', results, true)
  assert.match(summary ?? '', /County occupational health bid/)
  assert.match(summary ?? '', /county\.gov/)
  assert.equal(buildGroundedSummary('query', 'web', results, false), undefined)
})
''')

package_path = Path('package.json')
package = json.loads(package_path.read_text())
package['scripts']['test:settings'] = 'npx --yes tsx --test scripts/settings-search.test.ts'
package['scripts']['verify'] = 'npm run typecheck && npm run test:settings && npm run build'
package_path.write_text(json.dumps(package, indent=2) + '\n')

replace_once(
    '.github/workflows/ci.yml',
    "      - name: Production build\n        run: npm run build\n",
    "      - name: Settings and search tests\n        run: npm run test:settings\n\n      - name: Production build\n        run: npm run build\n"
)
