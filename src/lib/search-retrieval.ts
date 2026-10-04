import {
  buildBrowserSearchPlan,
  type BrowserSearchPlan,
  type BrowserSearchVariant,
} from './browser-search-pipeline'
import { createSearchTrace, recordSearchFlightStage } from './search-flight-recorder'
import {
  canAttemptSearchSource,
  recordSearchSourceFailure,
  recordSearchSourceSuccess,
  searchSourceHealthSnapshot,
} from './search-source-health'
import { searchBingHTML, searchDuckDuckGo, searchGoogleScrape } from './search'
import { searchSearXNG } from './searxng'
import { isKeenableConfigured, keenableKeyCount, searchKeenable } from './keenable'
import {
  exaKeyCount,
  isExaConfigured,
  isLangSearchConfigured,
  isTavilyConfigured,
  isTinyFishConfigured,
  langSearchKeyCount,
  searchExa,
  searchLangSearch,
  searchTavily,
  searchTinyFish,
  tavilyKeyCount,
  tinyFishKeyCount,
  type RenewableSearchResponse,
} from './renewable-search-providers'
import type { SearchRetrievalTransport } from './search-candidate-processing'
import {
  distinctRetrievalCoverage,
  selectDirectRescueVariants,
  shouldRunDirectRescue,
} from './search-retrieval-coverage'
import type { ScrapedResult } from '../types/search'

import { allocateProviderQueries, normalizeResearchQuery, RESEARCH_LIMITS } from './adaptive-research-planner'
const SEARCH_BUDGET_MS = 50_000
const SEARX_VARIANT_TIMEOUT_MS = 10_000
const KEENABLE_VARIANT_TIMEOUT_MS = 12_000
const EXTERNAL_VARIANT_TIMEOUT_MS = 10_000
const MAX_DIRECT_RESCUE_VARIANTS = 6
const MAX_KEENABLE_VARIANTS = boundedEnv('KEENABLE_MAX_VARIANTS', 6, 1, 8)
const MAX_TINYFISH_VARIANTS = boundedEnv('TINYFISH_MAX_VARIANTS', 6, 1, 8)
const MAX_TAVILY_VARIANTS = boundedEnv('TAVILY_MAX_VARIANTS', 4, 1, 8)
const MAX_EXA_VARIANTS = boundedEnv('EXA_MAX_VARIANTS', 3, 1, 8)
const MAX_LANGSEARCH_VARIANTS = boundedEnv('LANGSEARCH_MAX_VARIANTS', 3, 1, 8)

interface RetrievalCandidate {
  title: string
  url: string
  description: string
  source: string
  rank: number
  score: number
  query: string
  purpose: string
  research?: BrowserSearchVariant['research']
}

interface RetrievalDiagnostic {
  query: string
  engine: string
  resultCount: number
  latencyMs?: number
  circuitOpen?: boolean
  error?: string
}

interface VariantResult {
  candidates: RetrievalCandidate[]
  engines: string[]
  diagnostic: RetrievalDiagnostic
  ok: boolean
  configured: boolean
}

interface ProviderDefinition {
  name: string
  configured: boolean
  maxVariants: number
  run: (variant: BrowserSearchVariant, maxResults: number) => Promise<RenewableSearchResponse>
}

function boundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function coercePlan(value: unknown): BrowserSearchPlan | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BrowserSearchPlan>
  if (typeof candidate.query !== 'string' || !candidate.query.trim()) return null
  if (!Array.isArray(candidate.searches) || candidate.searches.length === 0) return null

  const fallback = buildBrowserSearchPlan(
    candidate.query.trim(),
    Math.min(12, candidate.searches.length),
    candidate.intent
  )
  const searches = candidate.searches
    .slice(0, 12)
    .filter(search =>
      search
      && typeof search.query === 'string'
      && search.query.trim()
      && typeof search.purpose === 'string'
      && Number.isFinite(Number(search.priority))
    )
    .map((search, index) => ({
      id: typeof search.id === 'string' && search.id.trim() ? search.id : `q${index + 1}`,
      query: search.query.trim(),
      purpose: search.purpose,
      priority: Number(search.priority),
    })) as BrowserSearchVariant[]

  if (searches.length === 0) return fallback

  return {
    ...fallback,
    searches,
    maxResultsPerSearch: Number.isFinite(Number(candidate.maxResultsPerSearch))
      ? Math.max(5, Math.min(50, Number(candidate.maxResultsPerSearch)))
      : fallback.maxResultsPerSearch,
    traceId: typeof candidate.traceId === 'string' ? candidate.traceId : fallback.traceId,
  }
}

export function traceIdFromPlan(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const traceId = (value as { traceId?: unknown }).traceId
  return typeof traceId === 'string' && traceId.trim() ? traceId.trim().slice(0, 100) : undefined
}

function toCandidates(results: ScrapedResult[], variant: BrowserSearchVariant, sourcePrefix?: string): RetrievalCandidate[] {
  return results.map((result, index) => ({
    title: result.title,
    url: result.url,
    description: result.description || '',
    source: sourcePrefix ? `${sourcePrefix} · ${result.source}` : result.source,
    rank: result.rank || index + 1,
    score: Number.isFinite(result.score) && result.score > 0 ? result.score : Math.max(10, 100 - index * 2),
    query: variant.query,
    purpose: variant.purpose,
    research: variant.research,
  }))
}

async function runSearxVariant(variant: BrowserSearchVariant, maxResults: number): Promise<VariantResult> {
  const source = 'SearXNG'
  if (!canAttemptSearchSource(source)) {
    return {
      candidates: [],
      engines: [],
      diagnostic: {
        query: variant.query,
        engine: source,
        resultCount: 0,
        circuitOpen: true,
        error: 'Circuit open after repeated SearXNG failures.',
      },
      ok: false,
      configured: true,
    }
  }

  const startedAt = Date.now()
  try {
    const response = await searchSearXNG(variant.query, {
      safeSearch: true,
      preferredLanguage: 'en',
      maxResults,
      timeoutMs: SEARX_VARIANT_TIMEOUT_MS,
    })
    const latencyMs = Date.now() - startedAt
    if (response.ok) recordSearchSourceSuccess(source, latencyMs)
    else recordSearchSourceFailure(source, latencyMs, response.error || 'SearXNG request failed')

    return {
      candidates: toCandidates(response.results, variant),
      engines: response.engines,
      diagnostic: {
        query: variant.query,
        engine: source,
        resultCount: response.results.length,
        latencyMs,
        ...(response.error ? { error: response.error } : {}),
      },
      ok: response.ok && response.results.length > 0,
      configured: response.configured,
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    recordSearchSourceFailure(source, latencyMs, message)
    return {
      candidates: [],
      engines: [],
      diagnostic: { query: variant.query, engine: source, resultCount: 0, latencyMs, error: message },
      ok: false,
      configured: true,
    }
  }
}

async function runKeenableVariant(variant: BrowserSearchVariant, maxResults: number): Promise<VariantResult> {
  const source = 'Keenable'
  if (!canAttemptSearchSource(source)) {
    return {
      candidates: [],
      engines: [],
      diagnostic: {
        query: variant.query,
        engine: source,
        resultCount: 0,
        circuitOpen: true,
        error: 'Circuit open after repeated Keenable failures.',
      },
      ok: false,
      configured: true,
    }
  }

  const startedAt = Date.now()
  try {
    const response = await searchKeenable(variant.query, {
      maxResults,
      timeoutMs: KEENABLE_VARIANT_TIMEOUT_MS,
      mode: process.env.KEENABLE_SEARCH_MODE || 'pro',
    })
    const latencyMs = Date.now() - startedAt

    if (response.configured) {
      if (response.ok) recordSearchSourceSuccess(source, latencyMs)
      else recordSearchSourceFailure(source, latencyMs, response.error || 'Keenable request failed')
    }

    return {
      candidates: toCandidates(response.results, variant),
      engines: response.results.length > 0 ? [source] : [],
      diagnostic: {
        query: variant.query,
        engine: source,
        resultCount: response.results.length,
        latencyMs,
        ...(response.error ? { error: response.error } : {}),
      },
      ok: response.ok && response.results.length > 0,
      configured: response.configured,
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    recordSearchSourceFailure(source, latencyMs, message)
    return {
      candidates: [],
      engines: [],
      diagnostic: { query: variant.query, engine: source, resultCount: 0, latencyMs, error: message },
      ok: false,
      configured: true,
    }
  }
}

async function runRenewableVariant(
  provider: ProviderDefinition,
  variant: BrowserSearchVariant,
  maxResults: number
): Promise<VariantResult> {
  const source = provider.name
  if (!canAttemptSearchSource(source)) {
    return {
      candidates: [],
      engines: [],
      diagnostic: {
        query: variant.query,
        engine: source,
        resultCount: 0,
        circuitOpen: true,
        error: `Circuit open after repeated ${source} failures.`,
      },
      ok: false,
      configured: true,
    }
  }

  const startedAt = Date.now()
  try {
    const response = await provider.run(variant, maxResults)
    const latencyMs = Date.now() - startedAt

    if (response.configured) {
      if (response.ok) recordSearchSourceSuccess(source, latencyMs)
      else recordSearchSourceFailure(source, latencyMs, response.error || `${source} request failed`)
    }

    return {
      candidates: toCandidates(response.results, variant),
      engines: response.results.length > 0 ? [source] : [],
      diagnostic: {
        query: variant.query,
        engine: source,
        resultCount: response.results.length,
        latencyMs,
        ...(response.error ? { error: response.error } : {}),
      },
      ok: response.ok && response.results.length > 0,
      configured: response.configured,
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    recordSearchSourceFailure(source, latencyMs, message)
    return {
      candidates: [],
      engines: [],
      diagnostic: { query: variant.query, engine: source, resultCount: 0, latencyMs, error: message },
      ok: false,
      configured: true,
    }
  }
}

async function runDirectRescue(variant: BrowserSearchVariant) {
  const jobs = [
    { name: 'Google', run: () => searchGoogleScrape(variant.query, { safeSearch: true, preferredLanguage: 'en', region: 'us' }) },
    { name: 'DuckDuckGo', run: () => searchDuckDuckGo(variant.query, { safeSearch: true, preferredLanguage: 'en', region: 'us' }) },
    { name: 'Bing', run: () => searchBingHTML(variant.query, { safeSearch: true, preferredLanguage: 'en', region: 'us' }) },
  ]

  const runnable = jobs.filter(job => canAttemptSearchSource(job.name))
  const diagnostics: RetrievalDiagnostic[] = jobs
    .filter(job => !runnable.includes(job))
    .map(job => ({
      query: variant.query,
      engine: job.name,
      resultCount: 0,
      circuitOpen: true,
      error: `Circuit open after repeated ${job.name} failures.`,
    }))

  const settled = await Promise.allSettled(runnable.map(async job => {
    const startedAt = Date.now()
    try {
      const data = await job.run()
      const latencyMs = Date.now() - startedAt
      recordSearchSourceSuccess(job.name, latencyMs)
      return { job, data, latencyMs }
    } catch (error) {
      const latencyMs = Date.now() - startedAt
      const message = error instanceof Error ? error.message : String(error)
      recordSearchSourceFailure(job.name, latencyMs, message)
      throw Object.assign(new Error(message), { sourceName: job.name, latencyMs })
    }
  }))

  const candidates: RetrievalCandidate[] = []
  const engines: string[] = []
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      const { job, data, latencyMs } = item.value
      engines.push(job.name)
      candidates.push(...toCandidates(data.results.slice(0, 15), variant, 'Direct rescue'))
      diagnostics.push({ query: variant.query, engine: job.name, resultCount: data.results.length, latencyMs })
    } else {
      const reason = item.reason as { sourceName?: string; latencyMs?: number; message?: string }
      diagnostics.push({
        query: variant.query,
        engine: reason.sourceName || 'Direct rescue',
        resultCount: 0,
        latencyMs: reason.latencyMs,
        error: reason.message || String(item.reason),
      })
    }
  }

  return { candidates, diagnostics, engines }
}

function transportFor(
  searxCandidates: number,
  keenableCandidates: number,
  renewableCandidates: number,
  rescueCandidates: number
): SearchRetrievalTransport {
  if (renewableCandidates > 0) {
    return rescueCandidates > 0 ? 'multi-source+direct-rescue' : 'multi-source'
  }
  if (searxCandidates > 0 && keenableCandidates > 0 && rescueCandidates > 0) return 'searxng+keenable+direct-rescue'
  if (searxCandidates > 0 && keenableCandidates > 0) return 'searxng+keenable'
  if (searxCandidates > 0 && rescueCandidates > 0) return 'searxng+direct-rescue'
  if (keenableCandidates > 0 && rescueCandidates > 0) return 'keenable+direct-rescue'
  if (keenableCandidates > 0) return 'keenable'
  if (rescueCandidates > 0) return 'zero-key-direct-rescue'
  return 'searxng'
}

function providerDefinitions(): ProviderDefinition[] {
  const purpose = 'Find current, real procurement opportunities matching the supplied search query.'
  return [
    {
      name: 'TinyFish',
      configured: isTinyFishConfigured(),
      maxVariants: MAX_TINYFISH_VARIANTS,
      run: (variant, maxResults) => searchTinyFish(variant.query, {
        maxResults,
        timeoutMs: EXTERNAL_VARIANT_TIMEOUT_MS,
        purpose,
      }),
    },
    {
      name: 'Tavily',
      configured: isTavilyConfigured(),
      maxVariants: MAX_TAVILY_VARIANTS,
      run: (variant, maxResults) => searchTavily(variant.query, {
        maxResults,
        timeoutMs: EXTERNAL_VARIANT_TIMEOUT_MS,
      }),
    },
    {
      name: 'Exa',
      configured: isExaConfigured(),
      maxVariants: MAX_EXA_VARIANTS,
      run: (variant, maxResults) => searchExa(variant.query, {
        maxResults,
        timeoutMs: EXTERNAL_VARIANT_TIMEOUT_MS,
      }),
    },
    {
      name: 'LangSearch',
      configured: isLangSearchConfigured(),
      maxVariants: MAX_LANGSEARCH_VARIANTS,
      run: (variant, maxResults) => searchLangSearch(variant.query, {
        maxResults,
        timeoutMs: EXTERNAL_VARIANT_TIMEOUT_MS,
      }),
    },
  ]
}

export interface RetrievalOptions { adaptive?: boolean; wave?: number; signal?: AbortSignal; deadline?: number }

export async function executeSearchRetrieval(plan: BrowserSearchPlan, options: RetrievalOptions = {}) {
    options.signal?.throwIfAborted()
    const startedAt = Date.now()
    const query = plan.query
    const traceId = createSearchTrace(query, plan.traceId)
    recordSearchFlightStage(traceId, 'retrieval.start', { query, wave: options.wave || 1 })
    const used = new Set<string>()
    const variants = plan.searches.filter(search => {
      const normalized = normalizeResearchQuery(search.query)
      if (!normalized || used.has(normalized)) return false
      used.add(normalized)
      return true
    }).slice(0, options.adaptive ? RESEARCH_LIMITS.queriesPerWave : 12)
    const diagnostics: RetrievalDiagnostic[] = []
    const allCandidates: RetrievalCandidate[] = []
    const engines = new Set<string>()
    let successfulSearches = 0
    let searxSuccessfulSearches = 0
    let externalSuccessfulSearches = 0
    let searxConfigured = true
    const keenableConfigured = isKeenableConfigured()
    const providers = providerDefinitions()

    const counts = {
      searxng: 0,
      keenable: 0,
      tinyfish: 0,
      tavily: 0,
      exa: 0,
      langsearch: 0,
      directRescue: 0,
    }

    const allocations = allocateProviderQueries(variants, [
      { name: 'SearXNG', configured: true, maxVariants: variants.length },
      { name: 'Keenable', configured: keenableConfigured, maxVariants: MAX_KEENABLE_VARIANTS },
      ...providers,
    ], options.adaptive ? RESEARCH_LIMITS.providerCallsPerWave - 3 : Number.POSITIVE_INFINITY)
    const searxVariants = allocations.get('SearXNG') || []
    const keenableVariants = allocations.get('Keenable') || []
    const keenablePromise = Promise.all(
      keenableVariants.map(variant => runKeenableVariant(variant, plan.maxResultsPerSearch))
    )

    const providerPromises = providers.map(provider => ({
      provider,
      variants: allocations.get(provider.name) || [],
      promise: provider.configured
        ? Promise.all((allocations.get(provider.name) || []).map(variant => runRenewableVariant(provider, variant, plan.maxResultsPerSearch)))
        : Promise.resolve([] as VariantResult[]),
    }))

    const concurrency = options.adaptive ? RESEARCH_LIMITS.queriesPerWave : 3
    for (let start = 0; start < searxVariants.length; start += concurrency) {
      if (options.signal?.aborted || (options.deadline && Date.now() >= options.deadline) || Date.now() - startedAt >= (options.adaptive ? 30_000 : SEARCH_BUDGET_MS) - 10_000) {
        diagnostics.push({
          query,
          engine: 'SearXNG',
          resultCount: 0,
          error: 'Search request budget reached before all SearXNG waves completed.',
        })
        break
      }

      const wave = searxVariants.slice(start, start + concurrency)
      const results = await Promise.all(wave.map(variant => runSearxVariant(variant, plan.maxResultsPerSearch)))
      for (const result of results) {
        diagnostics.push(result.diagnostic)
        result.engines.forEach(engine => engines.add(engine))
        allCandidates.push(...result.candidates)
        counts.searxng += result.candidates.length
        if (result.ok) {
          successfulSearches += 1
          searxSuccessfulSearches += 1
        }
        if (!result.configured) searxConfigured = false
      }
    }

    const searxUniqueCandidateCount = distinctRetrievalCoverage(allCandidates)

    const keenableResults = await keenablePromise
    for (const result of keenableResults) {
      diagnostics.push(result.diagnostic)
      result.engines.forEach(engine => engines.add(engine))
      allCandidates.push(...result.candidates)
      counts.keenable += result.candidates.length
      if (result.ok) {
        successfulSearches += 1
        externalSuccessfulSearches += 1
      }
    }

    for (const entry of providerPromises) {
      const results = await entry.promise
      for (const result of results) {
        diagnostics.push(result.diagnostic)
        result.engines.forEach(engine => engines.add(engine))
        allCandidates.push(...result.candidates)
        const key = entry.provider.name.toLowerCase() as 'tinyfish' | 'tavily' | 'exa' | 'langsearch'
        counts[key] += result.candidates.length
        if (result.ok) {
          successfulSearches += 1
          externalSuccessfulSearches += 1
        }
      }
    }

    const primaryUniqueCandidateCount = distinctRetrievalCoverage(allCandidates)
    const attemptedExternalSearches = keenableVariants.length
      + providerPromises.reduce((sum, entry) => sum + entry.variants.length, 0)
    const rescueNeeded = shouldRunDirectRescue({
      uniqueCandidateCount: primaryUniqueCandidateCount,
      successfulSearches: searxSuccessfulSearches + externalSuccessfulSearches,
      attemptedSearches: Math.max(variants.length, attemptedExternalSearches),
    })

    let rescueVariants: BrowserSearchVariant[] = []
    if (rescueNeeded && !options.signal?.aborted && (!options.deadline || Date.now() < options.deadline - 10_000) && Date.now() - startedAt < (options.adaptive ? 30_000 : SEARCH_BUDGET_MS) - 5_000) {
      rescueVariants = selectDirectRescueVariants(variants, options.adaptive ? 1 : MAX_DIRECT_RESCUE_VARIANTS)
      const rescues = await Promise.all(rescueVariants.map(variant => runDirectRescue(variant)))
      for (const rescue of rescues) {
        diagnostics.push(...rescue.diagnostics)
        rescue.engines.forEach(engine => engines.add(engine))
        if (rescue.candidates.length > 0) successfulSearches += 1
        counts.directRescue += rescue.candidates.length
        allCandidates.push(...rescue.candidates)
      }
    }

    const renewableCandidateCount = counts.tinyfish + counts.tavily + counts.exa + counts.langsearch
    const transport = transportFor(counts.searxng, counts.keenable, renewableCandidateCount, counts.directRescue)
    const runtimeMs = Date.now() - startedAt
    const totalUniqueCandidateCount = distinctRetrievalCoverage(allCandidates)
    const rescueStrategy = rescueVariants.map(variant => ({ purpose: variant.purpose, query: variant.query }))
    const sourceHealth = searchSourceHealthSnapshot()

    recordSearchFlightStage(traceId, 'retrieval.complete', {
      wave: options.wave || 1,
      runtimeMs,
      transport,
      attemptedSearches: searxVariants.length,
      attemptedExternalSearches,
      successfulSearches,
      rescueTriggered: rescueNeeded,
      candidateCounts: {
        ...counts,
        searxngUnique: searxUniqueCandidateCount,
        primaryUnique: primaryUniqueCandidateCount,
        totalUnique: totalUniqueCandidateCount,
      },
      diagnostics: diagnostics.map(diagnostic => ({ ...diagnostic, research: variants.find(variant => variant.query === diagnostic.query)?.research })),
      sourceHealth,
    })

    const configuredSources = {
      searxng: searxConfigured,
      keenable: keenableConfigured,
      tinyfish: isTinyFishConfigured(),
      tavily: isTavilyConfigured(),
      exa: isExaConfigured(),
      langsearch: isLangSearchConfigured(),
    }

    const keyPools = {
      keenable: keenableKeyCount(),
      tinyfish: tinyFishKeyCount(),
      tavily: tavilyKeyCount(),
      exa: exaKeyCount(),
      langsearch: langSearchKeyCount(),
    }

    const common = {
      traceId,
      transport,
      searxngConfigured: searxConfigured,
      keenableConfigured,
      tinyfishConfigured: configuredSources.tinyfish,
      tavilyConfigured: configuredSources.tavily,
      exaConfigured: configuredSources.exa,
      langsearchConfigured: configuredSources.langsearch,
      configuredSources,
      keyPools,
      keenableAttemptedSearches: keenableVariants.length,
      attemptedExternalSearches,
      apiKeysRequired: false as const,
      providerCalls: searxVariants.length + attemptedExternalSearches + rescueVariants.length * 3,
      attemptedSearches: searxVariants.length,
      successfulSearches,
      runtimeMs,
      diagnostics: diagnostics.map(diagnostic => ({ ...diagnostic, research: variants.find(variant => variant.query === diagnostic.query)?.research })),
      sourceHealth,
      rescueTriggered: rescueNeeded,
      rescueStrategy,
      candidateCounts: {
        ...counts,
        searxngUnique: searxUniqueCandidateCount,
        primaryUnique: primaryUniqueCandidateCount,
        totalUnique: totalUniqueCandidateCount,
      },
    }

    return { results: allCandidates, engines: Array.from(engines), ...common }
}
