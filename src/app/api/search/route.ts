import { NextRequest, NextResponse } from 'next/server'
import {
  buildBrowserSearchPlan,
  type BrowserSearchPlan,
  type BrowserSearchVariant,
} from '../../../lib/browser-search-pipeline'
import { searchBingHTML, searchDuckDuckGo } from '../../../lib/search'
import { searchSearXNG } from '../../../lib/searxng'
import type { SearchRetrievalTransport } from '../../../lib/search-candidate-processing'
import type { ScrapedResult } from '../../../types/search'

const SEARCH_BUDGET_MS = 50_000
const SEARX_VARIANT_TIMEOUT_MS = 10_000

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
  error?: string
}

function coercePlan(value: unknown): BrowserSearchPlan | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BrowserSearchPlan>
  if (typeof candidate.query !== 'string' || !candidate.query.trim()) return null
  if (!Array.isArray(candidate.searches) || candidate.searches.length === 0) return null
  return buildBrowserSearchPlan(candidate.query.trim(), Math.min(12, candidate.searches.length))
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
  const response = await searchSearXNG(variant.query, {
    safeSearch: true,
    preferredLanguage: 'en',
    maxResults,
    timeoutMs: SEARX_VARIANT_TIMEOUT_MS,
  })

  return {
    candidates: toCandidates(response.results, variant),
    engines: response.engines,
    diagnostic: {
      query: variant.query,
      engine: 'SearXNG',
      resultCount: response.results.length,
      ...(response.error ? { error: response.error } : {}),
    } satisfies RetrievalDiagnostic,
    ok: response.ok && response.results.length > 0,
    configured: response.configured,
  }
}

async function runDirectRescue(variant: BrowserSearchVariant) {
  const jobs = [
    { name: 'DuckDuckGo', run: () => searchDuckDuckGo(variant.query, { safeSearch: true, preferredLanguage: 'en', region: 'us' }) },
    { name: 'Bing', run: () => searchBingHTML(variant.query, { safeSearch: true, preferredLanguage: 'en', region: 'us' }) },
  ]

  const settled = await Promise.allSettled(jobs.map(async job => ({ job, data: await job.run() })))
  const candidates: RetrievalCandidate[] = []
  const diagnostics: RetrievalDiagnostic[] = []
  const engines: string[] = []

  for (const item of settled) {
    if (item.status === 'fulfilled') {
      const { job, data } = item.value
      engines.push(job.name)
      candidates.push(...toCandidates(data.results.slice(0, 15), variant, 'Direct rescue'))
      diagnostics.push({ query: variant.query, engine: job.name, resultCount: data.results.length })
    } else {
      diagnostics.push({
        query: variant.query,
        engine: 'Direct rescue',
        resultCount: 0,
        error: item.reason instanceof Error ? item.reason.message : String(item.reason),
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
 * unreachable, or sparse, a bounded DuckDuckGo/Bing HTML rescue keeps this
 * single-user internal app usable without extensions, downloads, or paid search APIs.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const body = (await request.json()) as { query?: unknown; plan?: unknown }
    const suppliedPlan = coercePlan(body.plan)
    const directQuery = typeof body.query === 'string' ? body.query.trim() : ''
    const query = suppliedPlan?.query || directQuery
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })

    const plan = suppliedPlan || buildBrowserSearchPlan(query, 8)
    const variants = plan.searches.slice(0, 8)
    const diagnostics: RetrievalDiagnostic[] = []
    const allCandidates: RetrievalCandidate[] = []
    const engines = new Set<string>()
    let successfulSearches = 0
    let searxConfigured = true
    let searxCandidateCount = 0
    let rescueCandidateCount = 0

    // Three-at-a-time waves limit pressure on the private metasearch service.
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
        if (result.ok) successfulSearches += 1
        if (!result.configured) searxConfigured = false
      }
    }

    // Rescue only when the metasearch pool is sparse. Run variants concurrently
    // so the worst case is bounded by one scraper timeout wave instead of four.
    if (allCandidates.length < 12 && Date.now() - startedAt < SEARCH_BUDGET_MS - 5_000) {
      const rescues = await Promise.all(variants.slice(0, 4).map(variant => runDirectRescue(variant)))
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

    if (allCandidates.length === 0) {
      return NextResponse.json({
        error: 'Search retrieval returned no candidates',
        code: searxConfigured ? 'SEARCH_SOURCES_EMPTY' : 'SEARXNG_UNAVAILABLE',
        detail: searxConfigured
          ? 'SearXNG and the bounded direct-engine rescue returned no usable search results.'
          : 'Private SearXNG is not configured, and the zero-key direct-engine rescue was unable to return results.',
        transport,
        searxngConfigured: searxConfigured,
        apiKeysRequired: false,
        attemptedSearches: variants.length,
        successfulSearches,
        runtimeMs,
        diagnostics,
      }, { status: 502 })
    }

    return NextResponse.json({
      results: allCandidates,
      engines: Array.from(engines),
      attemptedSearches: variants.length,
      successfulSearches,
      diagnostics,
      transport,
      searxngConfigured: searxConfigured,
      apiKeysRequired: false,
      runtimeMs,
      candidateCounts: {
        searxng: searxCandidateCount,
        directRescue: rescueCandidateCount,
      },
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (error) {
    return NextResponse.json({
      error: 'Search retrieval failed',
      detail: error instanceof Error ? error.message : String(error),
      apiKeysRequired: false,
    }, { status: 500 })
  }
}
