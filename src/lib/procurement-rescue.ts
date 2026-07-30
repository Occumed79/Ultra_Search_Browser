import { searchManagedWeb } from './managed-search'
import { buildProcurementRescueQueries } from './procurement-rescue-queries'
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

export async function rescueProcurementCandidates(
  query: string,
  options: ProcurementRescueOptions
): Promise<{ results: ScrapedResult[]; diagnostics: ProcurementRescueDiagnostics }> {
  const queries = buildProcurementRescueQueries(query, options.semanticIntent)
  const managed = await searchManagedWeb(query, {
    safeSearch: options.safeSearch,
    preferredLanguage: options.preferredLanguage,
    region: options.region,
    limit: 15,
    queryVariants: queries,
  })
  const gated = applyIntentCandidateGate(
    query,
    'procurement',
    managed.results,
    options.semanticIntent
  )
  const attempts = managed.diagnostics.attempts
  const failures = attempts
    .filter(attempt => attempt.status !== 'success')
    .map(attempt =>
      `${attempt.provider}: ${attempt.error || (attempt.status === 'empty' ? 'no usable links' : 'request failed')}`
    )

  return {
    results: gated.results,
    diagnostics: {
      attemptedQueries: new Set(attempts.map(attempt => attempt.query)).size,
      attemptedTasks: managed.diagnostics.attemptedRequests,
      successfulTasks: managed.diagnostics.successfulRequests,
      rawCandidates: managed.results.length,
      retainedCandidates: gated.results.length,
      failures,
      queries,
      rawPreview: managed.results.slice(0, 12).map(result => ({
        source: result.source,
        title: result.title,
        url: result.url,
      })),
    },
  }
}
