import { searchManagedWeb } from './managed-search'
import {
  buildProcurementBrowserRescueTasks,
  type ProcurementBrowserRescueTask,
} from './procurement-browser-rescue-tasks'
import { searchMojeekHtml } from './public-search-fallbacks'
import {
  buildProcurementRescueQueries,
  buildProcurementTitleQueries,
} from './procurement-rescue-queries'
import { searchBingResilient, searchDuckDuckGoResilient } from './resilient-search'
import { searchSamGovOpportunities } from './sam-gov-opportunities'
import { applyIntentCandidateGate } from './search-intent-gate'
import type { SemanticIntentPlan } from './semantic-intent'
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
}

export interface ProcurementRescueOptions {
  safeSearch: boolean
  preferredLanguage: string
  region: string
  semanticIntent?: SemanticIntentPlan
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
      : await searchMojeekHtml(task.query, searchOptions)

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

export async function rescueProcurementCandidates(
  query: string,
  options: ProcurementRescueOptions
): Promise<{ results: ScrapedResult[]; diagnostics: ProcurementRescueDiagnostics }> {
  const queries = buildProcurementRescueQueries(query, options.semanticIntent)
  const titleQueries = buildProcurementTitleQueries(query, options.semanticIntent)
  const [managed, samGov] = await Promise.all([
    searchManagedWeb(query, {
      safeSearch: options.safeSearch,
      preferredLanguage: options.preferredLanguage,
      region: options.region,
      limit: 15,
      queryVariants: queries,
    }),
    searchSamGovOpportunities(titleQueries),
  ])
  const indexedResults = mergeUniqueResults([managed.results, samGov.results])
  const indexedGate = applyIntentCandidateGate(
    query,
    'procurement',
    indexedResults,
    options.semanticIntent
  )

  const browserTasks = indexedGate.results.length === 0
    ? buildProcurementBrowserRescueTasks(queries)
    : []
  const browserSettled = await Promise.allSettled(
    browserTasks.map(task => runBrowserTask(task, options))
  )
  const browserResults = browserSettled.flatMap(item =>
    item.status === 'fulfilled' ? item.value : []
  )
  const rawResults = mergeUniqueResults([indexedResults, browserResults])
  const gated = applyIntentCandidateGate(
    query,
    'procurement',
    rawResults,
    options.semanticIntent
  )

  const managedFailures = managed.diagnostics.attempts
    .filter(attempt => attempt.status !== 'success')
    .map(attempt =>
      `${attempt.provider}: ${attempt.error || (attempt.status === 'empty' ? 'no usable links' : 'request failed')}`
    )
  const samGovFailures = samGov.diagnostics.failures.map(failure => `SAM.gov: ${failure}`)
  const browserFailures = browserSettled.flatMap((item, index) => {
    if (item.status === 'fulfilled') {
      return item.value.length > 0
        ? []
        : [`${browserTasks[index].source}: no usable links for ${browserTasks[index].query}`]
    }
    const message = item.reason instanceof Error ? item.reason.message : String(item.reason)
    return [`${browserTasks[index].source}: ${message}`]
  })
  const successfulBrowserTasks = browserSettled.filter(
    item => item.status === 'fulfilled' && item.value.length > 0
  ).length
  const attemptedQuerySet = new Set([
    ...managed.diagnostics.attempts.map(attempt => attempt.query),
    ...samGov.diagnostics.queries,
    ...browserTasks.map(task => task.query),
  ])

  return {
    results: gated.results,
    diagnostics: {
      attemptedQueries: attemptedQuerySet.size,
      attemptedTasks: managed.diagnostics.attemptedRequests
        + samGov.diagnostics.attemptedRequests
        + browserTasks.length,
      successfulTasks: managed.diagnostics.successfulRequests
        + samGov.diagnostics.successfulRequests
        + successfulBrowserTasks,
      rawCandidates: rawResults.length,
      retainedCandidates: gated.results.length,
      failures: [...managedFailures, ...samGovFailures, ...browserFailures],
      queries: [...titleQueries, ...queries],
      rawPreview: rawResults.slice(0, 12).map(result => ({
        source: result.source,
        title: result.title,
        url: result.url,
      })),
    },
  }
}
