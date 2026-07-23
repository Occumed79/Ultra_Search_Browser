import { NextRequest, NextResponse } from 'next/server'
import { buildIntelligenceObject } from '../../../lib/intelligence'
import { applyResultFeedbackRanking } from '../../../lib/result-feedback-ranking'
import { orchestrateSearch } from '../../../lib/search-orchestrator'
import { buildGroundedSummary, buildSearchPlan } from '../../../lib/search-settings'
import { insertSearchResult, insertSearchRun } from '../../../lib/search-storage'
import type { SearchLens } from '../../../types/search'

const VALID_LENSES = new Set<SearchLens>([
  'web',
  'pdf',
  'government',
  'procurement',
  'pricing',
  'provider',
  'technical',
  'news',
  'legal',
  'medical',
  'academic',
  'financial',
])

export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const body = (await request.json()) as { query?: string; lens?: SearchLens; settings?: unknown }
    const query = body.query?.trim() || ''

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const requestedLens: SearchLens = body.lens && VALID_LENSES.has(body.lens)
      ? body.lens
      : 'web'
    const plan = buildSearchPlan(body.settings)
    const orchestration = await orchestrateSearch(query, requestedLens, plan)
    const noExternalResults = orchestration.diagnostics.successfulLiveTasks === 0
      && orchestration.diagnostics.memoryKeywordMatches === 0
      && orchestration.diagnostics.memoryVectorMatches === 0
      && orchestration.diagnostics.smallWebMatches === 0
      && orchestration.diagnostics.marginaliaMatches === 0

    if (orchestration.results.length === 0 && noExternalResults && orchestration.failures.length > 0) {
      return NextResponse.json(
        {
          error: 'All retrieval sources failed',
          detail: 'The selected web sources were blocked, timed out, or returned unreadable search pages. This is a retrieval failure, not a legitimate zero-result search.',
          query: orchestration.normalizedQuery,
          lens: orchestration.lens,
          diagnostics: orchestration.diagnostics,
        },
        { status: 502 }
      )
    }

    orchestration.results = await applyResultFeedbackRanking(orchestration.results)

    const note = orchestration.failures.length > 0
      ? `${orchestration.failures.length} retrieval tasks failed or returned unreadable pages; successful sources were preserved.`
      : undefined
    const intelligence = buildIntelligenceObject(
      orchestration.normalizedQuery,
      orchestration.expanded,
      orchestration.sources,
      orchestration.rawTexts,
      note
    )
    intelligence.summary = buildGroundedSummary(
      orchestration.normalizedQuery,
      orchestration.lens,
      orchestration.results,
      plan.autoSummarize
    )

    const runtimeMs = Date.now() - startedAt
    let searchRunId: string | null = null
    const persistedResultIds = new Map<string, string>()

    try {
      searchRunId = await insertSearchRun({
        vertical: orchestration.lens,
        query,
        normalized_query: orchestration.normalizedQuery,
        lens: orchestration.lens,
        result_count: orchestration.results.length,
        runtime_ms: runtimeMs,
        sources: orchestration.sources,
        operators: {
          parsed: orchestration.operators,
          variants: orchestration.diagnostics.queryVariants,
          failures: orchestration.failures,
          enabledSources: [...plan.liveSources, ...(plan.useMemory ? ['memory'] : [])],
        },
      })

      if (searchRunId) {
        const persisted = await Promise.allSettled(
          orchestration.results.slice(0, 30).map(async result => {
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
              extraction_status: 'search-result',
              metadata: {
                lens: orchestration.lens,
                retrieval: (result as typeof result & { retrieval?: unknown }).retrieval,
              },
            })
            return { url: result.url, id }
          })
        )

        for (const item of persisted) {
          if (item.status === 'fulfilled' && item.value.id) {
            persistedResultIds.set(item.value.url, item.value.id)
          }
        }
      }
    } catch (persistenceError) {
      console.warn('Search persistence failed:', persistenceError)
    }

    const responseResults = orchestration.results.map(result => ({
      ...result,
      id: persistedResultIds.get(result.url),
    }))

    return NextResponse.json({
      query: orchestration.normalizedQuery,
      lens: orchestration.lens,
      summary: intelligence.summary,
      expandedQueries: orchestration.diagnostics.queryVariants
        .map(variant => variant.query)
        .filter(variant => variant.toLowerCase() !== orchestration.normalizedQuery.toLowerCase()),
      signals: intelligence.signals,
      results: responseResults,
      searchRunId,
      sources: orchestration.sources,
      timestamp: intelligence.timestamp,
      confidence: intelligence.confidence,
      diagnostics: {
        runtimeMs,
        enabledSources: [...plan.liveSources, ...(plan.useMemory ? ['memory'] : [])],
        safeSearch: plan.safeSearch,
        failures: orchestration.failures,
        ...orchestration.diagnostics,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown search failure'
    console.error('Search API failure:', error)

    return NextResponse.json(
      {
        error: 'Search failed',
        detail: message,
        stage: 'search-orchestration',
      },
      { status: 500 }
    )
  }
}
