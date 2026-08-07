import { applyOccuMedSmartFilter } from './occumed-smart-filter'
import {
  coerceBrowserIntent,
  normalizeBrowserSerpCandidates,
  type BrowserSearchVariant,
  type BrowserSerpCandidateInput,
} from './browser-search-pipeline'
import { applyResultFeedbackRanking } from './result-feedback-ranking'
import { applyIntentCandidateGate } from './search-intent-gate'
import { buildSearchPlan } from './search-settings'
import { insertSearchResult, insertSearchRun } from './search-storage'

export type SearchRetrievalTransport = 'searxng' | 'zero-key-direct-rescue' | 'searxng+direct-rescue' | 'fixture'

export interface ProcessSearchCandidatesInput {
  query: string
  intent?: unknown
  results: BrowserSerpCandidateInput[]
  searches?: BrowserSearchVariant[]
  settings?: unknown
  transport: SearchRetrievalTransport
  retrievalMode: string
  productMode: string
  rawCandidateLabel?: string
  persist?: boolean
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

export async function processSearchCandidates(input: ProcessSearchCandidatesInput) {
  const startedAt = Date.now()
  const plan = buildSearchPlan(input.settings)
  const intent = coerceBrowserIntent(input.intent, input.query)
  const normalizedCandidates = normalizeBrowserSerpCandidates(input.results)
  const intentGate = applyIntentCandidateGate(input.query, 'procurement', normalizedCandidates, intent)
  const smartFilter = await applyOccuMedSmartFilter(
    input.query,
    'procurement',
    intentGate.results,
    Math.max(plan.resultsPerPage, 40),
    {
      useLocalTransformer: false,
      useExternalProviders: false,
      semanticIntent: intent,
    }
  )

  let rankedResults = smartFilter.results
  try {
    rankedResults = await applyResultFeedbackRanking(rankedResults)
  } catch (error) {
    console.warn('Candidate feedback reranking failed; preserving locally filtered order:', error)
  }

  const sources = uniqueStrings(normalizedCandidates.flatMap(result => result.retrieval?.sources || [result.source]))
  const expandedQueries = uniqueStrings((input.searches || []).map(search => search.query))
    .filter(value => value.toLowerCase() !== input.query.toLowerCase())
  const runtimeMs = Date.now() - startedAt
  let searchRunId: string | null = null
  const persistedResultIds = new Map<string, string>()
  const shouldPersist = input.persist !== false
  let persistenceFailures = 0

  if (shouldPersist) {
    try {
      searchRunId = await insertSearchRun({
        vertical: 'procurement',
        query: input.query,
        normalized_query: input.query,
        lens: 'procurement',
        result_count: rankedResults.length,
        runtime_ms: runtimeMs,
        sources,
        operators: {
          transport: input.transport,
          apiKeysRequired: false,
          searches: input.searches || [],
          rawCandidates: normalizedCandidates.length,
          intentGate: intentGate.diagnostics,
          smartFilter: smartFilter.diagnostics,
          productMode: input.productMode,
        },
      })

      if (searchRunId) {
        const persisted = await Promise.allSettled(
          rankedResults.slice(0, 40).map(async result => {
            const id = await insertSearchResult({
              search_run_id: searchRunId as string,
              url: result.url,
              normalized_url: result.url,
              domain: result.domain,
              title: result.title,
              snippet: result.description,
              source_engine: result.source,
              rank: result.rank,
              score: result.score,
              final_score: result.score,
              extraction_status: 'candidate',
              metadata: {
                lens: 'procurement',
                verificationStatus: 'candidate',
                retrieval: result.retrieval,
                validation: result.validation,
                transport: input.transport,
              },
            })
            return { url: result.url, id }
          })
        )

        for (const item of persisted) {
          if (item.status === 'fulfilled' && item.value.id) {
            persistedResultIds.set(item.value.url, item.value.id)
          } else if (item.status === 'rejected') {
            persistenceFailures += 1
          }
        }
        if (persistenceFailures > 0) {
          console.warn(`Search result persistence failed for ${persistenceFailures} rows.`)
        }
      }
    } catch (error) {
      persistenceFailures = Math.max(persistenceFailures, rankedResults.slice(0, 40).length || 1)
      console.warn('Search candidate persistence failed:', error)
    }
  }

  const results = rankedResults.map(result => ({
    ...result,
    id: persistedResultIds.get(result.url),
  }))

  return {
    query: input.query,
    lens: 'procurement' as const,
    requestedLens: 'procurement' as const,
    summary: results.length === 0
      ? 'Search retrieval completed, but the Occu-Med relevance gate discarded every raw result as irrelevant, generic, expired, or insufficiently procurement-specific.'
      : undefined,
    expandedQueries,
    signals: [],
    results,
    searchRunId,
    sources,
    timestamp: new Date().toISOString(),
    confidence: 0,
    intent,
    diagnostics: {
      runtimeMs,
      retrievalMode: input.retrievalMode,
      transport: input.transport,
      apiKeysRequired: false,
      [input.rawCandidateLabel || 'rawCandidates']: normalizedCandidates.length,
      intentGate: intentGate.diagnostics,
      smartFilter: smartFilter.diagnostics,
      productMode: input.productMode,
      persistenceAttempted: shouldPersist,
      persistenceFailures,
      persisted: shouldPersist && persistenceFailures === 0,
    },
  }
}
