import { NextRequest, NextResponse } from 'next/server'
import {
  buildBrowserSearchPlan,
  type BrowserSearchPlan,
  type BrowserSearchVariant,
} from '../../../lib/browser-search-pipeline'
import { createSearchTrace, finishSearchTrace, recordSearchFlightStage } from '../../../lib/search-flight-recorder'
import {
  canAttemptSearchSource,
  recordSearchSourceFailure,
  recordSearchSourceSuccess,
  searchSourceHealthSnapshot,
} from '../../../lib/search-source-health'
import { searchBingHTML, searchDuckDuckGo, searchGoogleScrape } from '../../../lib/search'
import { searchSearXNG } from '../../../lib/searxng'
import type { SearchRetrievalTransport } from '../../../lib/search-candidate-processing'
import {
  distinctRetrievalCoverage,
  selectDirectRescueVariants,
  shouldRunDirectRescue,
} from '../../../lib/search-retrieval-coverage'
import type { ScrapedResult } from '../../../types/search'

const SEARCH_BUDGET_MS = 50_000
const SEARX_VARIANT_TIMEOUT_MS = 10_000
const MAX_DIRECT_RESCUE_VARIANTS = 5

interface RetrievalCandidate {
  title: string
  url: string
  description: string
  source: string
  rank: number
  score: number
  query: string
  purpose: string
}

interface RetrievalDiagnostic {
  query: string
  engine: string
  resultCount: number
  latencyMs?: number
  circuitOpen?: boolean
  error?: string
}

function coercePlan(value: unknown): BrowserSearchPlan | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BrowserSearchPlan>
  if (typeof candidate.query !== 'string' || !candidate.query.trim()) return null
  if (!Array.isArray(candidate.searches) || candidate.searches.length === 0) return null
  return buildBrowserSearchPlan(candidate.query.trim(), Math.min(12, candidate.searches.length))
}

function traceIdFromPlan(value: unknown): string | undefined {
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
  }))
}

async function runSearxVariant(variant: BrowserSearchVariant, maxResults: number) {
  const source = 'SearXNG'
  if (!canAttemptSearchSource(source)) {
    return {
      candidates: [] as RetrievalCandidate[],
      engines: [] as string[],
      diagnostic: {
        query: variant.query,
        engine: source,
        resultCount: 0,
        circuitOpen: true,
        error: 'Circuit open after repeated SearXNG failures.',
      } satisfies RetrievalDiagnostic,
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
      } satisfies RetrievalDiagnostic,
      ok: response.ok && response.results.length > 0,
      configured: response.configured,
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    recordSearchSourceFailure(source, latencyMs, message)
    return {
      candidates: [] as RetrievalCandidate[],
      engines: [] as string[],
      diagnostic: { query: variant.query, engine: source, resultCount: 0, latencyMs, error: message } satisfies RetrievalDiagnostic,
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

function transportFor(searxCandidates: number, rescueCandidates: number): SearchRetrievalTransport {
  if (searxCandidates > 0 && rescueCandidates > 0) return 'searxng+direct-rescue'
  if (rescueCandidates > 0) return 'zero-key-direct-rescue'
  return 'searxng'
}

/**
 * Zero-install, zero-search-key retrieval endpoint.
 *
 * Private SearXNG is the preferred metasearch layer. If it is not configured,
 * unreachable, effectively sparse, or temporarily circuit-broken, a bounded
 * Google/DuckDuckGo/Bing HTML rescue keeps this single-user internal app usable.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let traceId: string | undefined

  try {
    const body = (await request.json()) as { query?: unknown; plan?: unknown; traceId?: unknown }
    const suppliedPlan = coercePlan(body.plan)
    const directQuery = typeof body.query === 'string' ? body.query.trim() : ''
    const query = suppliedPlan?.query || directQuery
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })

    traceId = createSearchTrace(
      query,
      traceIdFromPlan(body.plan) || (typeof body.traceId === 'string' ? body.traceId : undefined)
    )
    recordSearchFlightStage(traceId, 'retrieval.start', { query })

    const plan = suppliedPlan || buildBrowserSearchPlan(query, 8)
    const variants = plan.searches.slice(0, 8)
    const diagnostics: RetrievalDiagnostic[] = []
    const allCandidates: RetrievalCandidate[] = []
    const engines = new Set<string>()
    let successfulSearches = 0
    let searxSuccessfulSearches = 0
    let searxConfigured = true
    let searxCandidateCount = 0
    let rescueCandidateCount = 0
    let rescueVariants: BrowserSearchVariant[] = []

    for (let start = 0; start < variants.length; start += 3) {
      if (Date.now() - startedAt >= SEARCH_BUDGET_MS - 10_000) {
        diagnostics.push({ query, engine: 'SearXNG', resultCount: 0, error: 'Search request budget reached before all SearXNG waves completed.' })
        break
      }

      const wave = variants.slice(start, start + 3)
      const results = await Promise.all(wave.map(variant => runSearxVariant(variant, plan.maxResultsPerSearch)))
      for (const result of results) {
        diagnostics.push(result.diagnostic)
        result.engines.forEach(engine => engines.add(engine))
        allCandidates.push(...result.candidates)
        searxCandidateCount += result.candidates.length
        if (result.ok) {
          successfulSearches += 1
          searxSuccessfulSearches += 1
        }
        if (!result.configured) searxConfigured = false
      }
    }

    const searxUniqueCandidateCount = distinctRetrievalCoverage(allCandidates)
    const rescueNeeded = shouldRunDirectRescue({
      uniqueCandidateCount: searxUniqueCandidateCount,
      successfulSearches: searxSuccessfulSearches,
      attemptedSearches: variants.length,
    })

    if (rescueNeeded && Date.now() - startedAt < SEARCH_BUDGET_MS - 5_000) {
      rescueVariants = selectDirectRescueVariants(variants, MAX_DIRECT_RESCUE_VARIANTS)
      const rescues = await Promise.all(rescueVariants.map(variant => runDirectRescue(variant)))
      for (const rescue of rescues) {
        diagnostics.push(...rescue.diagnostics)
        rescue.engines.forEach(engine => engines.add(engine))
        if (rescue.candidates.length > 0) successfulSearches += 1
        rescueCandidateCount += rescue.candidates.length
        allCandidates.push(...rescue.candidates)
      }
    }

    const transport = transportFor(searxCandidateCount, rescueCandidateCount)
    const runtimeMs = Date.now() - startedAt
    const totalUniqueCandidateCount = distinctRetrievalCoverage(allCandidates)
    const rescueStrategy = rescueVariants.map(variant => ({ purpose: variant.purpose, query: variant.query }))
    const sourceHealth = searchSourceHealthSnapshot()

    recordSearchFlightStage(traceId, 'retrieval.complete', {
      runtimeMs,
      transport,
      attemptedSearches: variants.length,
      successfulSearches,
      rescueTriggered: rescueNeeded,
      candidateCounts: {
        searxng: searxCandidateCount,
        searxngUnique: searxUniqueCandidateCount,
        directRescue: rescueCandidateCount,
        totalUnique: totalUniqueCandidateCount,
      },
      diagnostics,
      sourceHealth,
    })

    const common = {
      traceId,
      transport,
      searxngConfigured: searxConfigured,
      apiKeysRequired: false,
      attemptedSearches: variants.length,
      successfulSearches,
      runtimeMs,
      diagnostics,
      sourceHealth,
      rescueTriggered: rescueNeeded,
      rescueStrategy,
      candidateCounts: {
        searxng: searxCandidateCount,
        searxngUnique: searxUniqueCandidateCount,
        directRescue: rescueCandidateCount,
        totalUnique: totalUniqueCandidateCount,
      },
    }

    if (allCandidates.length === 0) {
      finishSearchTrace(traceId, 'error', { stage: 'retrieval', reason: 'no-candidates', transport })
      return NextResponse.json({
        error: 'Search retrieval returned no candidates',
        code: searxConfigured ? 'SEARCH_SOURCES_EMPTY' : 'SEARXNG_UNAVAILABLE',
        detail: searxConfigured
          ? 'SearXNG and the bounded direct-engine rescue returned no usable search results.'
          : 'Private SearXNG is not configured, and the zero-key direct-engine rescue was unable to return results.',
        ...common,
      }, { status: 502, headers: { 'X-Ultra-Search-Trace': traceId } })
    }

    return NextResponse.json({ results: allCandidates, engines: Array.from(engines), ...common }, {
      headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Ultra-Search-Trace': traceId },
    })
  } catch (error) {
    finishSearchTrace(traceId, 'error', { stage: 'retrieval', error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({
      error: 'Search retrieval failed',
      detail: error instanceof Error ? error.message : String(error),
      traceId,
      apiKeysRequired: false,
    }, { status: 500, headers: traceId ? { 'X-Ultra-Search-Trace': traceId } : undefined })
  }
}
