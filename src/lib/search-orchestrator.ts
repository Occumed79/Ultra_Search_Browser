import { applySpamPenalty, calculateCombinedSpamScore } from './anti-spam'
import { selectAutomaticBrowserFallbackTasks } from './automatic-browser-fallback'
import { parseBangs } from './bangs'
import { rerankWithCloudflare, type CloudflareRerankDiagnostics } from './cloudflare-reranker'
import { applyDomainPreferences, getDomainPreferences } from './domain-memory'
import {
  geminiGroundedSearchCapabilities,
  searchGeminiGroundedWeb,
  type GeminiGroundedSearchDiagnostics,
} from './gemini-grounded-search'
import { expandQuery, scoreSignals } from './intelligence'
import { evaluateIntentRelevance, intentRerankQuery } from './intent-relevance'
import {
  managedSearchCapabilities,
  searchManagedWeb,
  type ManagedSearchDiagnostics,
} from './managed-search'
import { searchMarginalia } from './marginalia'
import { dedupeByUrl, keywordSearchStoredResults, vectorSearchStoredResults } from './memory-retrieval'
import { calculateRankingPrecisionSignals } from './ranking-signals'
import { searchBingResilient, searchDuckDuckGoResilient } from './resilient-search'
import { searchBraveHtml, searchMojeekHtml, searchYahooHtml } from './public-search-fallbacks'
import { searchGoogleScrape, type SearchEngineOptions } from './search'
import {
  buildSearchOrchestrationPlan,
  searchCandidateLimit,
  type QueryPurpose,
  type RetrievalTask,
} from './search-planner'
import { parseSearchOperators, type OperatorsResult } from './search-operators'
import { routeSearchLens, type LensRoutingDecision } from './search-intent-routing'
import { planSemanticIntent, type SemanticIntentPlan } from './semantic-intent'
import { filterSafeResults, type LiveSearchSource, type SearchPlan } from './search-settings'
import { rerankResults } from './semantic-search'
import { isSearxngConfigured, searchSearXNG } from './searxng'
import { searchSmallWeb } from './small-web'
import type { ScrapedResult, SearchLens } from '../types/search'

const TASK_TIMEOUT_MS = 3_500
const MEMORY_TIMEOUT_MS = 4_000
const OPTIONAL_SOURCE_TIMEOUT_MS = 3_500
const SEARXNG_TIMEOUT_MS = 10_500

export interface SourceRunDiagnostic {
  source: string
  query: string
  purpose: QueryPurpose | 'managed-api' | 'gemini-grounded' | 'memory' | 'small-web' | 'always-on'
  status: 'success' | 'empty' | 'failed'
  resultCount: number
  runtimeMs: number
  error?: string
}

export interface SearchOrchestrationDiagnostics {
  normalizedQuery: string
  queryVariants: Array<{ query: string; purpose: QueryPurpose }>
  variantBudget: number
  taskBudget: number
  attemptedLiveTasks: number
  successfulLiveTasks: number
  failedLiveTasks: number
  memoryKeywordMatches: number
  memoryVectorMatches: number
  smallWebMatches: number
  marginaliaMatches: number
  searxngAlwaysOn: boolean
  localIndexAlwaysOn: boolean
  semanticIntent: SemanticIntentPlan
  lensRouting: LensRoutingDecision
  cloudflareRerank: CloudflareRerankDiagnostics
  managedSearch: ManagedSearchDiagnostics
  geminiGroundedSearch: GeminiGroundedSearchDiagnostics
  legacyHtmlSearchEnabled: boolean
  automaticBrowserFallbackEnabled: boolean
  sourceRuns: SourceRunDiagnostic[]
}

export interface OrchestratedSearch {
  normalizedQuery: string
  lens: SearchLens
  expanded: ReturnType<typeof expandQuery>
  operators: OperatorsResult
  results: ScrapedResult[]
  rawTexts: string[]
  sources: string[]
  failures: string[]
  diagnostics: SearchOrchestrationDiagnostics
}

interface TaskSuccess {
  task: RetrievalTask
  data: { text: string; results: ScrapedResult[] }
  runtimeMs: number
}

interface Occurrence {
  result: ScrapedResult
  sources: Set<string>
  queries: Set<string>
  purposes: Set<QueryPurpose>
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lowered = key.toLowerCase()
      if (lowered.startsWith('utm_') || lowered === 'fbclid' || lowered === 'gclid') {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

function normalizeResult(result: ScrapedResult, fallbackSource: string): ScrapedResult | null {
  if (!result?.title || !result?.url) return null
  try {
    const url = normalizeUrl(result.url)
    return {
      ...result,
      url,
      domain: result.domain || new URL(url).hostname.replace(/^www\./, ''),
      description: result.description || '',
      source: result.source || fallbackSource,
      rank: Number.isFinite(result.rank) ? result.rank : 1,
      score: Number.isFinite(result.score) ? result.score : 0,
    }
  } catch {
    return null
  }
}

function reconstructQuery(operators: OperatorsResult, fallback: string): string {
  return [...operators.exactPhrases, operators.cleanQuery]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || fallback.trim()
}

function applyOperatorFilters(results: ScrapedResult[], operators: OperatorsResult): ScrapedResult[] {
  return results.filter(result => {
    const domain = result.domain.toLowerCase().replace(/^www\./, '')
    const title = result.title.toLowerCase()
    const url = result.url.toLowerCase()
    const text = `${result.title} ${result.description} ${result.url}`.toLowerCase()

    if (operators.includedSites.length && !operators.includedSites.some(site => domain === site || domain.endsWith(`.${site}`))) return false
    if (operators.excludedSites.some(site => domain === site || domain.endsWith(`.${site}`))) return false
    if (operators.fileTypes.length && !operators.fileTypes.some(type => url.includes(`.${type.toLowerCase()}`))) return false
    if (operators.inTitleTerms.some(term => !title.includes(term.toLowerCase()))) return false
    if (operators.inUrlTerms.some(term => !url.includes(term.toLowerCase()))) return false
    if (operators.exactPhrases.some(phrase => !text.includes(phrase.toLowerCase()))) return false
    if (operators.excludedTerms.some(term => text.includes(term.toLowerCase()))) return false
    return true
  })
}

function lensBonus(result: ScrapedResult, lens: SearchLens): number {
  const domain = result.domain.toLowerCase()
  const url = result.url.toLowerCase()
  const text = `${result.title} ${result.description}`.toLowerCase()
  let score = 0

  if (['government', 'procurement', 'pdf', 'legal'].includes(lens)) {
    if (domain.endsWith('.gov') || domain.endsWith('.us')) score += 38
    if (/\.pdf(?:$|\?)/.test(url)) score += 34
  }
  if (lens === 'procurement' && /\b(rfp|rfq|ifb|bid|solicitation|tender|procurement|proposal)\b/.test(text)) score += 32
  if (lens === 'procurement' && /due date|deadline|responses due|closing date|currently open|active solicitation/.test(text)) score += 20
  if (lens === 'pricing' && /fee schedule|price|pricing|cost|cash pay|self-pay|rate|chargemaster/.test(text)) score += 28
  if (lens === 'provider' && /clinic|provider|medical center|occupational health|occupational medicine/.test(text)) score += 24
  if (lens === 'academic' && (domain.endsWith('.edu') || /journal|abstract|doi|research/.test(text))) score += 24
  if (lens === 'technical' && /github\.com|stackoverflow\.com|documentation|api reference/.test(`${domain} ${text}`)) score += 24
  // Prefer results that came from our always-on local index / SearXNG when they look procurement-relevant
  if (result.source === 'SearXNG' && lens === 'procurement' && /\b(rfp|rfq|bid|solicitation)\b/.test(text)) score += 8
  if (result.source === 'small-web' || result.source === 'procurement-index') score += 12
  return score
}

function purposeBonus(purposes: Set<QueryPurpose>): number {
  return (purposes.has('official') ? 10 : 0)
    + (purposes.has('document') ? 10 : 0)
    + (purposes.has('freshness') ? 8 : 0)
    + (purposes.has('portal') ? 8 : 0)
    + (purposes.has('ai-intent') ? 7 : 0)
    + (purposes.has('intent-core') ? 7 : 0)
    + (purposes.has('semantic') ? 4 : 0)
}

function sourceExecutor(source: LiveSearchSource, options: SearchEngineOptions) {
  const executors: Record<LiveSearchSource, (query: string) => Promise<{ text: string; results: ScrapedResult[] }>> = {
    google: query => searchGoogleScrape(query, options),
    bing: query => searchBingResilient(query, options),
    duckduckgo: query => searchDuckDuckGoResilient(query, options),
    brave: query => searchBraveHtml(query, options),
    mojeek: query => searchMojeekHtml(query, options),
    yahoo: query => searchYahooHtml(query, options),
    searxng: query => searchSearXNG(query, options),
  }
  return executors[source]
}

async function runLiveTask(task: RetrievalTask, options: SearchEngineOptions): Promise<TaskSuccess> {
  const startedAt = Date.now()
  const timeout = task.source === 'searxng' ? SEARXNG_TIMEOUT_MS : TASK_TIMEOUT_MS
  console.log(`Running live task: ${task.source} with query: "${task.query}" (timeout: ${timeout}ms)`)
  
  try {
    const data = await withTimeout(
      sourceExecutor(task.source, options)(task.query),
      timeout,
      `${task.source} search`
    )
    const results = data.results
      .map(result => normalizeResult(result, task.source))
      .filter((result): result is ScrapedResult => Boolean(result))
    
    console.log(`Live task completed: ${task.source} returned ${results.length} results`)
    console.log(`Sample results from ${task.source}:`, results.slice(0, 3).map(r => ({ title: r.title, url: r.url })))
    
    if (!results.length) throw new Error(`${task.source} returned no parseable results`)
    return { task, data: { ...data, results }, runtimeMs: Date.now() - startedAt }
  } catch (error) {
    console.error(`Live task failed: ${task.source} with query: "${task.query}"`, error)
    throw error
  }
}

function smallWebCategory(lens: SearchLens): string | undefined {
  if (lens === 'procurement') return 'procurement'
  if (lens === 'government') return 'government'
  if (lens === 'pricing') return 'pricing'
  if (lens === 'provider') return 'provider'
  return undefined
}

function addResults(
  occurrences: Map<string, Occurrence>,
  results: ScrapedResult[],
  source: string,
  query: string,
  purpose: QueryPurpose = 'semantic'
) {
  for (const rawResult of results) {
    const result = normalizeResult(rawResult, source)
    if (!result) continue
    const key = normalizeUrl(result.url).toLowerCase()
    const existing = occurrences.get(key)
    if (existing) {
      existing.sources.add(source)
      existing.queries.add(query)
      existing.purposes.add(purpose)
      if (result.score > existing.result.score) existing.result = result
    } else {
      occurrences.set(key, {
        result,
        sources: new Set([source]),
        queries: new Set([query]),
        purposes: new Set([purpose]),
      })
    }
  }
}

/**
 * Always-on SearXNG tasks: run every search when SEARXNG_URL is configured,
 * independent of user source toggles and independent of managed API health.
 */
function buildAlwaysOnSearxngTasks(
  variants: Array<{ query: string; purpose: QueryPurpose }>,
  normalizedQuery: string
): RetrievalTask[] {
  if (!isSearxngConfigured()) return []

  const preferred = variants.filter(v =>
    v.purpose === 'broad'
    || v.purpose === 'intent-core'
    || v.purpose === 'portal'
    || v.purpose === 'official'
    || v.purpose === 'freshness'
  )
  const chosen = (preferred.length > 0 ? preferred : variants).slice(0, 3)
  const tasks: RetrievalTask[] = chosen.map(variant => ({
    source: 'searxng' as const,
    query: variant.query,
    purpose: variant.purpose,
  }))

  // Ensure the literal user query always hits SearXNG at least once
  if (!tasks.some(t => t.query.toLowerCase() === normalizedQuery.toLowerCase())) {
    tasks.unshift({
      source: 'searxng',
      query: normalizedQuery,
      purpose: 'broad',
    })
  }

  // Dedupe by query
  const seen = new Set<string>()
  return tasks.filter(task => {
    const key = task.query.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 4)
}

export async function orchestrateSearch(
  rawQuery: string,
  requestedLens: SearchLens,
  plan: SearchPlan
): Promise<OrchestratedSearch> {
  const bangs = parseBangs(rawQuery)
  const operators = parseSearchOperators(bangs.cleanQuery || rawQuery)
  const normalizedQuery = reconstructQuery(operators, bangs.cleanQuery || rawQuery)
  const semanticIntent = await planSemanticIntent(normalizedQuery, requestedLens)
  console.log('DEBUG: requestedLens:', requestedLens, 'normalizedQuery:', normalizedQuery)
  console.log('DEBUG: semanticIntent:', JSON.stringify(semanticIntent, null, 2))
  
  const lensRouting = routeSearchLens(
    requestedLens,
    bangs.forcedVertical,
    normalizedQuery,
    semanticIntent
  )
  const lens = lensRouting.effectiveLens
  console.log('DEBUG: lensRouting:', lensRouting, 'final lens:', lens)
  const expanded = expandQuery(normalizedQuery, lens)
  const orchestration = buildSearchOrchestrationPlan(
    normalizedQuery,
    lens,
    expanded,
    operators,
    plan,
    new Date().getFullYear(),
    semanticIntent
  )
  const options: SearchEngineOptions = {
    safeSearch: plan.safeSearch,
    preferredLanguage: plan.preferredLanguage,
    region: plan.region,
  }

  const managedCapabilities = managedSearchCapabilities()
  const legacyHtmlSearchEnabled = process.env.ENABLE_LEGACY_HTML_SEARCH === 'true'
  const automaticBrowserFallbackEnabled = !managedCapabilities.configured
  const automaticBrowserTasks = selectAutomaticBrowserFallbackTasks(
    orchestration.tasks,
    automaticBrowserFallbackEnabled
  )

  console.log('Search orchestration debug:', {
    totalTasks: orchestration.tasks.length,
    liveSources: plan.liveSources,
    legacyHtmlSearchEnabled,
    automaticBrowserFallbackEnabled,
    automaticBrowserTasks: automaticBrowserTasks.length,
    taskSample: orchestration.tasks.slice(0, 5).map(t => ({ source: t.source, query: t.query, purpose: t.purpose }))
  })

  // User-selected / legacy live tasks (excluding SearXNG — handled as always-on below)
  const planLiveTasks = orchestration.tasks.filter(task => {
    // Always include tasks for sources that are in the user's selected sources
    if (plan.liveSources.includes(task.source)) return true
    
    // For legacy HTML search, only include if enabled or in automatic fallback tasks
    if (task.source !== 'searxng' && (legacyHtmlSearchEnabled || automaticBrowserTasks.includes(task))) return true
    
    // Include searxng if it's in user's selected sources
    if (task.source === 'searxng' && plan.liveSources.includes('searxng')) return true
    
    return false
  })

  console.log('Filtered live tasks:', {
    beforeFilter: orchestration.tasks.length,
    afterFilter: planLiveTasks.length,
    filteredTasks: planLiveTasks.slice(0, 5).map(t => ({ source: t.source, query: t.query, purpose: t.purpose }))
  })

  // ALWAYS-ON: SearXNG runs on every request when configured
  const alwaysOnSearxng = buildAlwaysOnSearxngTasks(
    orchestration.variants,
    normalizedQuery
  )
  const searxngAlwaysOn = alwaysOnSearxng.length > 0

  // Merge without duplicate source:query pairs
  const liveTaskKeys = new Set(planLiveTasks.map(t => `${t.source}:${t.query.toLowerCase()}`))
  const mergedLiveTasks = [
    ...planLiveTasks,
    ...alwaysOnSearxng.filter(t => !liveTaskKeys.has(`${t.source}:${t.query.toLowerCase()}`)),
  ]

  const livePromise = Promise.allSettled(mergedLiveTasks.map(task => runLiveTask(task, options)))
  const managedPromise = searchManagedWeb(normalizedQuery, {
    safeSearch: plan.safeSearch,
    preferredLanguage: plan.preferredLanguage,
    region: plan.region,
    limit: Math.min(20, Math.max(10, plan.resultsPerPage)),
    queryVariants: orchestration.variants
      .filter(variant =>
        variant.purpose === 'intent-core'
        || variant.purpose === 'ai-intent'
        || variant.purpose === 'official'
        || variant.purpose === 'document'
      )
      .map(variant => variant.query),
  })

  const hasDatabase = Boolean(process.env.DATABASE_URL)
  // ALWAYS-ON: local index (keyword memory + small-web feeds) whenever DB is configured
  const localIndexAlwaysOn = hasDatabase
  const keywordPromise = hasDatabase
    ? withTimeout(keywordSearchStoredResults(normalizedQuery, lens, operators, 20), MEMORY_TIMEOUT_MS, 'keyword memory search').catch(() => [] as ScrapedResult[])
    : Promise.resolve([] as ScrapedResult[])
  const vectorPromise = hasDatabase && plan.useMemory
    ? withTimeout(vectorSearchStoredResults(normalizedQuery, lens, 12), MEMORY_TIMEOUT_MS, 'vector memory search').catch(() => [] as ScrapedResult[])
    : Promise.resolve([] as ScrapedResult[])
  const smallWebPromise: Promise<Awaited<ReturnType<typeof searchSmallWeb>>> = hasDatabase
    ? withTimeout(searchSmallWeb(normalizedQuery, smallWebCategory(lens), 15), MEMORY_TIMEOUT_MS, 'small web / procurement index search').catch(() => [])
    : Promise.resolve([])
  const useMarginalia = process.env.ENABLE_MARGINALIA !== 'false'
    && ['web', 'provider', 'pricing', 'academic', 'news'].includes(lens)
  const marginaliaPromise = useMarginalia
    ? withTimeout(searchMarginalia(normalizedQuery), OPTIONAL_SOURCE_TIMEOUT_MS, 'Marginalia search')
        .catch(() => ({ text: '', results: [] as ScrapedResult[] }))
    : Promise.resolve({ text: '', results: [] as ScrapedResult[] })

  const [liveSettled, managedSearch, memoryKeyword, memoryVector, smallWebEntries, marginalia] = await Promise.all([
    livePromise,
    managedPromise,
    keywordPromise,
    vectorPromise,
    smallWebPromise,
    marginaliaPromise,
  ])
  const liveResultCount = liveSettled.reduce(
    (total, item) => total + (item.status === 'fulfilled' ? item.value.data.results.length : 0),
    0
  )
  const geminiGroundedSearch = managedSearch.results.length === 0 && liveResultCount === 0
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

  const occurrences = new Map<string, Occurrence>()
  const sourceRuns: SourceRunDiagnostic[] = []
  const sourceLabels = new Set<string>()
  const failures: string[] = []
  const rawTexts: string[] = []

  liveSettled.forEach((settled, index) => {
    const task = mergedLiveTasks[index]
    if (settled.status === 'rejected') {
      const error = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
      failures.push(`${task.source}: ${error}`)
      sourceRuns.push({
        source: task.source,
        query: task.query,
        purpose: task.source === 'searxng' && searxngAlwaysOn ? 'always-on' : task.purpose,
        status: 'failed',
        resultCount: 0,
        runtimeMs: task.source === 'searxng' ? SEARXNG_TIMEOUT_MS : TASK_TIMEOUT_MS,
        error,
      })
      return
    }

    const { data, runtimeMs } = settled.value
    sourceRuns.push({
      source: task.source,
      query: task.query,
      purpose: task.source === 'searxng' && searxngAlwaysOn ? 'always-on' : task.purpose,
      status: 'success',
      resultCount: data.results.length,
      runtimeMs,
    })
    sourceLabels.add(
      task.source === 'searxng'
        ? 'SearXNG · always-on'
        : `${task.source} · ${task.purpose}`
    )
    if (data.text.trim()) rawTexts.push(data.text)
    addResults(occurrences, data.results, task.source === 'searxng' ? 'SearXNG' : task.source, task.query, task.purpose)
  })

  for (const result of managedSearch.results) {
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
  for (const attempt of managedSearch.diagnostics.attempts) {
    sourceRuns.push({
      source: attempt.provider,
      query: attempt.query,
      purpose: 'managed-api',
      status: attempt.status,
      resultCount: attempt.resultCount,
      runtimeMs: attempt.runtimeMs,
      error: attempt.error,
    })
    if (attempt.status === 'failed') {
      failures.push(`${attempt.provider}: ${attempt.error || 'managed search request failed'}`)
    }
  }
  if (managedSearch.results.length > 0) {
    if (managedSearch.text.trim()) rawTexts.push(managedSearch.text)
    for (const provider of managedSearch.diagnostics.attempts
      .filter(attempt => attempt.status === 'success')
      .map(attempt => attempt.provider)) {
      sourceLabels.add(`${provider} · managed-api`)
    }
  }
  if (!managedCapabilities.configured && mergedLiveTasks.length === 0 && !geminiGroundedSearch.diagnostics.configured) {
    failures.push(
      'managed search: no supported API search provider is configured and no always-on sources returned results'
    )
  }

  addResults(occurrences, memoryKeyword, 'memory-keyword', normalizedQuery)
  addResults(occurrences, memoryVector, 'memory-vector', normalizedQuery)
  addResults(occurrences, marginalia.results, 'marginalia', normalizedQuery)
  addResults(
    occurrences,
    smallWebEntries.map((entry, index) => ({
      title: entry.title,
      url: entry.url,
      description: entry.description || entry.content || '',
      domain: (() => {
        try { return new URL(entry.url).hostname.replace(/^www\./, '') } catch { return '' }
      })(),
      source: entry.category === 'procurement' ? 'procurement-index' : 'small-web',
      rank: index + 1,
      score: 0,
    })),
    entryCategorySource(smallWebEntries),
    normalizedQuery
  )

  if (memoryKeyword.length) sourceLabels.add('memory-keyword · always-on')
  if (memoryVector.length) sourceLabels.add('memory-vector')
  if (smallWebEntries.length) sourceLabels.add('procurement-index / small-web · always-on')
  if (marginalia.results.length) sourceLabels.add('marginalia')

  if (localIndexAlwaysOn) {
    sourceRuns.push({
      source: 'procurement-index',
      query: normalizedQuery,
      purpose: 'always-on',
      status: smallWebEntries.length > 0 || memoryKeyword.length > 0 ? 'success' : 'empty',
      resultCount: smallWebEntries.length + memoryKeyword.length,
      runtimeMs: 0,
    })
  }

  let results: ScrapedResult[] = Array.from(occurrences.values()).map(({ result, sources, queries, purposes }) => {
    const signalScore = scoreSignals(`${result.title} ${result.description}`, result.url)
      .reduce((total, signal) => total + signal.score, 0)
    const overlap = Math.max(0, sources.size - 1) * 12 + Math.max(0, queries.size - 1) * 6
    const baseScore = Math.max(0, 90 - Math.min(result.rank || 1, 40) * 2)
    const intent = evaluateIntentRelevance(semanticIntent, lens, result)
    return {
      ...result,
      score: baseScore
        + signalScore * 0.35
        + lensBonus(result, lens)
        + overlap
        + purposeBonus(purposes)
        + intent.adjustment,
      retrieval: {
        sources: Array.from(sources),
        queries: Array.from(queries),
        purposes: Array.from(purposes),
        overlap: sources.size,
      },
    }
  })

  results = applyOperatorFilters(filterSafeResults(results, plan.safeSearch), operators)
  results = dedupeByUrl(results)

  try {
    const semanticQuery = intentRerankQuery(semanticIntent)
    const semantic = rerankResults(
      semanticQuery,
      results.map(result => ({
        id: result.url,
        text: `${result.title} ${result.description}`,
        url: result.url,
        title: result.title,
        source: result.source,
      })),
      results.length
    )
    const semanticScores = new Map(semantic.map(item => [item.id, item.score]))
    results = results.map(result => {
      const precision = calculateRankingPrecisionSignals(semanticQuery, lens, result)
      return {
        ...result,
        score: result.score
          + Math.max(0, semanticScores.get(result.url) || 0) * 35
          + precision.totalAdjustment,
      }
    })
  } catch (error) {
    console.warn('Local semantic reranking failed:', error)
  }

  const cloudflare = await rerankWithCloudflare(intentRerankQuery(semanticIntent), results)
  results = cloudflare.results

  results = results.map(result => {
    const spam = calculateCombinedSpamScore(result.url, `${result.title} ${result.description}`)
    return {
      ...result,
      score: applySpamPenalty(result.score, spam.score),
      spamScore: spam.score,
      spamReasons: spam.reasons,
    }
  })

  if (process.env.DATABASE_URL) {
    try {
      const applied = applyDomainPreferences(results, await getDomainPreferences('default'))
      results = (applied.results as ScrapedResult[]).map(result => {
        const adjustment = applied.adjustments.get(result.url)
        return adjustment ? { ...result, score: adjustment.adjustedScore } : result
      })
    } catch (error) {
      console.warn('Domain preference orchestration failed:', error)
    }
  }

  results.sort((left, right) => right.score - left.score)
  results = results
    .slice(0, searchCandidateLimit(plan.resultsPerPage))
    .map((result, index) => ({ ...result, rank: index + 1 }))

  return {
    normalizedQuery,
    lens,
    expanded,
    operators,
    results,
    rawTexts,
    sources: Array.from(sourceLabels),
    failures,
    diagnostics: {
      normalizedQuery,
      queryVariants: orchestration.variants.map(({ query, purpose }) => ({ query, purpose })),
      variantBudget: orchestration.variantBudget,
      taskBudget: orchestration.taskBudget,
      attemptedLiveTasks: mergedLiveTasks.length
        + managedSearch.diagnostics.attemptedRequests
        + (geminiGroundedSearch.diagnostics.attempted ? 1 : 0),
      successfulLiveTasks: liveSettled.filter(item => item.status === 'fulfilled').length
        + managedSearch.diagnostics.successfulRequests
        + (geminiGroundedSearch.diagnostics.successful ? 1 : 0),
      failedLiveTasks: liveSettled.filter(item => item.status === 'rejected').length
        + managedSearch.diagnostics.failedRequests
        + (geminiGroundedSearch.diagnostics.attempted && !geminiGroundedSearch.diagnostics.successful ? 1 : 0),
      memoryKeywordMatches: memoryKeyword.length,
      memoryVectorMatches: memoryVector.length,
      smallWebMatches: smallWebEntries.length,
      marginaliaMatches: marginalia.results.length,
      searxngAlwaysOn,
      localIndexAlwaysOn,
      semanticIntent,
      lensRouting,
      cloudflareRerank: cloudflare.diagnostics,
      managedSearch: managedSearch.diagnostics,
      geminiGroundedSearch: geminiGroundedSearch.diagnostics,
      legacyHtmlSearchEnabled,
      automaticBrowserFallbackEnabled,
      sourceRuns,
    },
  }
}

function entryCategorySource(entries: Array<{ category?: string }>): string {
  if (entries.some(e => e.category === 'procurement')) return 'procurement-index'
  return 'small-web'
}
