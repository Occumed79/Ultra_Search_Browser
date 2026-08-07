import {
  geminiGroundedSearchCapabilities,
  searchGeminiGroundedWeb,
  type GeminiGroundedSearchDiagnostics,
} from './gemini-grounded-search'
import { searchManagedWeb } from './managed-search'
import {
  buildProcurementBrowserRescueTasks,
  type ProcurementBrowserRescueTask,
} from './procurement-browser-rescue-tasks'
import { searchBraveHtml, searchMojeekHtml, searchYahooHtml } from './public-search-fallbacks'
import { buildProcurementRescueQueries } from './procurement-rescue-queries'
import { searchBingResilient, searchDuckDuckGoResilient } from './resilient-search'
import { searchSamGovOfficial, type SamGovSearchDiagnostics } from './sam-gov-opportunities'
import { applyIntentCandidateGate } from './search-intent-gate'
import type { SemanticIntentPlan } from './semantic-intent'
import { searchTavilyWeb, type TavilySearchDiagnostics } from './tavily-search'
import type { ScrapedResult } from '../types/search'

export interface ProcurementRescueDiagnostics {
  attemptedQueries: number
  attemptedTasks: number
  successfulTasks: number
  rawCandidates: number
  retainedCandidates: number
  failures: string[]
  queries: string[]
  rawPreview: Array<{ source: string; title: string; url: string }>
  samGov: SamGovSearchDiagnostics
  tavily: TavilySearchDiagnostics
  geminiGroundedSearch: GeminiGroundedSearchDiagnostics
}

export interface ProcurementRescueOptions {
  safeSearch: boolean
  preferredLanguage: string
  region: string
  semanticIntent?: SemanticIntentPlan
  skipManagedSearch?: boolean
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.trim()
  }
}

function mergeUniqueResults(resultSets: ScrapedResult[][]): ScrapedResult[] {
  const seen = new Set<string>()
  const merged: ScrapedResult[] = []

  for (const result of resultSets.flat()) {
    const key = normalizeUrl(result.url).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push({
      ...result,
      url: normalizeUrl(result.url),
      rank: merged.length + 1,
      retrieval: {
        sources: Array.from(new Set([...(result.retrieval?.sources || []), result.source])),
        queries: Array.from(new Set(result.retrieval?.queries || [])),
        purposes: Array.from(new Set([...(result.retrieval?.purposes || []), 'procurement-rescue'])),
        overlap: Math.max(1, result.retrieval?.overlap || 1),
      },
    })
  }

  return merged
}

async function runBrowserTask(
  task: ProcurementBrowserRescueTask,
  options: ProcurementRescueOptions
): Promise<ScrapedResult[]> {
  const searchOptions = {
    safeSearch: options.safeSearch,
    preferredLanguage: options.preferredLanguage,
    region: options.region,
  }

  const response = task.source === 'bing'
    ? await searchBingResilient(task.query, searchOptions)
    : task.source === 'duckduckgo'
      ? await searchDuckDuckGoResilient(task.query, searchOptions)
      : task.source === 'mojeek'
        ? await searchMojeekHtml(task.query, searchOptions)
        : task.source === 'yahoo'
          ? await searchYahooHtml(task.query, searchOptions)
          : await searchBraveHtml(task.query, searchOptions)

  return response.results.map(result => ({
    ...result,
    retrieval: {
      sources: Array.from(new Set([...(result.retrieval?.sources || []), result.source])),
      queries: Array.from(new Set([...(result.retrieval?.queries || []), task.query])),
      purposes: Array.from(new Set([...(result.retrieval?.purposes || []), 'procurement-rescue'])),
      overlap: Math.max(1, result.retrieval?.overlap || 1),
    },
  }))
}

function skippedGroundedDiagnostics(): GeminiGroundedSearchDiagnostics {
  return {
    ...geminiGroundedSearchCapabilities(),
    attempted: false,
    successful: false,
    resultCount: 0,
    runtimeMs: 0,
    searchQueries: [],
  }
}

export async function rescueProcurementCandidates(
  query: string,
  options: ProcurementRescueOptions
): Promise<{ results: ScrapedResult[]; diagnostics: ProcurementRescueDiagnostics }> {
  const queries = buildProcurementRescueQueries(query, options.semanticIntent)

  // This whole function is already the weak-coverage rescue path. Tavily gets
  // one basic-search request here—not on every normal search—so the configured
  // trial allowance is useful without becoming the primary dependency.
  const samPromise = searchSamGovOfficial(query, 15)
  const tavilyPromise = searchTavilyWeb(query, 15)

  const managed = options.skipManagedSearch
    ? {
        results: [] as ScrapedResult[],
        diagnostics: {
          attempts: [] as Array<{
            provider: string
            query: string
            status: 'success' | 'empty' | 'failed'
            resultCount: number
            runtimeMs: number
            error?: string
          }>,
          attemptedRequests: 0,
          successfulRequests: 0,
        },
      }
    : await searchManagedWeb(query, {
        safeSearch: options.safeSearch,
        preferredLanguage: options.preferredLanguage,
        region: options.region,
        limit: 20,
        queryVariants: queries,
      })

  const browserTasks = buildProcurementBrowserRescueTasks(queries)
  const [sam, tavily, browserSettled] = await Promise.all([
    samPromise,
    tavilyPromise,
    Promise.allSettled(browserTasks.map(task => runBrowserTask(task, options))),
  ])
  const browserResults = browserSettled.flatMap(item =>
    item.status === 'fulfilled' ? item.value : []
  )
  const firstPassRaw = mergeUniqueResults([
    sam.results,
    tavily.results,
    managed.results,
    browserResults,
  ])
  const firstPassGate = applyIntentCandidateGate(
    query,
    'procurement',
    firstPassRaw,
    options.semanticIntent
  )

  // Gemini grounding remains the final weak-coverage fallback. It is only
  // attempted when all non-grounded rescue sources still retain zero usable
  // procurement candidates after the same relevance gate.
  const grounded = firstPassGate.results.length === 0
    ? await searchGeminiGroundedWeb(query, 'procurement')
    : {
        text: '',
        results: [] as ScrapedResult[],
        diagnostics: skippedGroundedDiagnostics(),
      }

  const rawResults = grounded.results.length > 0
    ? mergeUniqueResults([firstPassRaw, grounded.results])
    : firstPassRaw
  const gated = grounded.results.length > 0
    ? applyIntentCandidateGate(query, 'procurement', rawResults, options.semanticIntent)
    : firstPassGate

  const managedFailures = managed.diagnostics.attempts
    .filter(attempt => attempt.status !== 'success')
    .map(attempt =>
      `${attempt.provider}: ${attempt.error || (attempt.status === 'empty' ? 'no usable links' : 'request failed')}`
    )
  const browserFailures = browserSettled.flatMap((item, index) => {
    if (item.status === 'fulfilled') {
      return item.value.length > 0
        ? []
        : [`${browserTasks[index].source}: no usable links for ${browserTasks[index].query}`]
    }
    const message = item.reason instanceof Error ? item.reason.message : String(item.reason)
    return [`${browserTasks[index].source}: ${message}`]
  })
  const samFailures = sam.diagnostics.error
    ? [`SAM.gov: ${sam.diagnostics.error}`]
    : []
  const tavilyFailures = tavily.diagnostics.attempted
    && !tavily.diagnostics.successful
    && tavily.diagnostics.error
    ? [`tavily: ${tavily.diagnostics.error}`]
    : []
  const groundedFailures = grounded.diagnostics.attempted
    && !grounded.diagnostics.successful
    && grounded.diagnostics.error
    ? [`gemini-google-search: ${grounded.diagnostics.error}`]
    : []
  const successfulBrowserTasks = browserSettled.filter(
    item => item.status === 'fulfilled' && item.value.length > 0
  ).length
  const attemptedQuerySet = new Set([
    ...managed.diagnostics.attempts.map(attempt => attempt.query),
    ...browserTasks.map(task => task.query),
    ...(tavily.diagnostics.attempted ? [query] : []),
    ...grounded.diagnostics.searchQueries,
  ])

  return {
    results: gated.results,
    diagnostics: {
      attemptedQueries: attemptedQuerySet.size,
      attemptedTasks: managed.diagnostics.attemptedRequests
        + browserTasks.length
        + (sam.diagnostics.attempted ? 1 : 0)
        + (tavily.diagnostics.attempted ? 1 : 0)
        + (grounded.diagnostics.attempted ? 1 : 0),
      successfulTasks: managed.diagnostics.successfulRequests
        + successfulBrowserTasks
        + (sam.diagnostics.successful ? 1 : 0)
        + (tavily.diagnostics.successful ? 1 : 0)
        + (grounded.diagnostics.successful ? 1 : 0),
      rawCandidates: rawResults.length,
      retainedCandidates: gated.results.length,
      failures: [
        ...samFailures,
        ...tavilyFailures,
        ...managedFailures,
        ...browserFailures,
        ...groundedFailures,
      ],
      queries,
      rawPreview: rawResults.slice(0, 12).map(result => ({
        source: result.source,
        title: result.title,
        url: result.url,
      })),
      samGov: sam.diagnostics,
      tavily: tavily.diagnostics,
      geminiGroundedSearch: grounded.diagnostics,
    },
  }
}
