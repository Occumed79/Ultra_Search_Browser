import { NextRequest, NextResponse } from 'next/server'
import { buildIntelligenceObject } from '../../../lib/intelligence'
import { rescueProcurementCandidates, type ProcurementRescueDiagnostics } from '../../../lib/procurement-rescue'
import { applyResultFeedbackRanking } from '../../../lib/result-feedback-ranking'
import { applyIntentCandidateGate } from '../../../lib/search-intent-gate'
import { orchestrateSearch } from '../../../lib/search-orchestrator'
import { buildSearchPlan } from '../../../lib/search-settings'
import { insertSearchResult, insertSearchRun } from '../../../lib/search-storage'
import { applySmartFilter } from '../../../lib/smart-filter'
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
    const lensRouting = orchestration.diagnostics.lensRouting
    const gated = applyIntentCandidateGate(
      orchestration.normalizedQuery,
      orchestration.lens,
      orchestration.results,
      orchestration.diagnostics.semanticIntent
    )
    orchestration.results = gated.results

    let procurementRescue: ProcurementRescueDiagnostics | undefined
    if (orchestration.lens === 'procurement' && orchestration.results.length === 0) {
      const rescued = await rescueProcurementCandidates(orchestration.normalizedQuery, {
        safeSearch: plan.safeSearch,
        preferredLanguage: plan.preferredLanguage,
        region: plan.region,
        semanticIntent: orchestration.diagnostics.semanticIntent,
      })
      procurementRescue = rescued.diagnostics
      orchestration.results = rescued.results
      if (rescued.results.length > 0) {
        orchestration.sources = Array.from(new Set([
          ...orchestration.sources,
          ...rescued.results.map(result => `${result.source} · procurement-rescue`),
        ]))
      }
      if (rescued.diagnostics.failures.length > 0) {
        orchestration.failures.push(...rescued.diagnostics.failures.map(error => `procurement rescue: ${error}`))
      }
    }

    const noExternalResults = orchestration.diagnostics.successfulLiveTasks === 0
      && orchestration.diagnostics.memoryKeywordMatches === 0
      && orchestration.diagnostics.memoryVectorMatches === 0
      && orchestration.diagnostics.smallWebMatches === 0
      && orchestration.diagnostics.marginaliaMatches === 0
      && (procurementRescue?.successfulTasks || 0) === 0

    if (orchestration.results.length === 0 && noExternalResults && orchestration.failures.length > 0) {
      const failureSummary = orchestration.diagnostics.sourceRuns
        .filter(run => run.status === 'failed')
        .slice(0, 6)
        .map(run => `${run.source}: ${run.error || 'request failed'}`)
        .join('; ')
      return NextResponse.json(
        {
          error: 'All retrieval sources failed',
          detail: failureSummary
            ? `Every configured search provider failed. ${failureSummary}`
            : 'Every configured search provider failed before returning usable results.',
          query: orchestration.normalizedQuery,
          lens: orchestration.lens,
          diagnostics: {
            ...orchestration.diagnostics,
            lensRouting,
            intentGate: gated.diagnostics,
            procurementRescue,
          },
        },
        { status: 502 }
      )
    }

    const smartFilter = await applySmartFilter(
      orchestration.normalizedQuery,
      orchestration.lens,
      orchestration.results,
      plan.resultsPerPage,
      {
        useLocalTransformer: false,
        // Initial results must not wait on a second external AI round trip.
        // Cerebras/Groq still review actual destination-page evidence in the
        // asynchronous validation stream.
        useExternalProviders: false,
        semanticIntent: orchestration.diagnostics.semanticIntent,
      }
    )
    orchestration.results = await applyResultFeedbackRanking(smartFilter.results)

    const noteParts = [
      lensRouting.autoRouted
        ? `The query was automatically routed from ${lensRouting.requestedLens} to ${lensRouting.effectiveLens}: ${lensRouting.reason}`
        : undefined,
      gated.diagnostics.rejected > 0
        ? `${gated.diagnostics.rejected} candidates were removed before AI review because they lacked procurement evidence or the requested subject.`
        : undefined,
      procurementRescue
        ? `A strict procurement rescue attempted ${procurementRescue.attemptedTasks} targeted retrieval tasks and retained ${procurementRescue.retainedCandidates} candidates.`
        : undefined,
      orchestration.failures.length > 0
        ? `${orchestration.failures.length} retrieval tasks failed or returned unreadable pages; successful sources were preserved.`
        : undefined,
    ].filter(Boolean)
    const intelligence = buildIntelligenceObject(
      orchestration.normalizedQuery,
      orchestration.expanded,
      orchestration.sources,
      orchestration.rawTexts,
      noteParts.join(' ') || undefined
    )

    // Search-engine snippets are discovery candidates, not verified evidence.
    // The destination-page stream is the only place allowed to produce a
    // summary or confidence score.
    intelligence.summary = orchestration.results.length === 0
      ? `No candidates matched the required ${orchestration.lens} intent. Generic definitions, indexes, and unrelated pages were excluded before page verification.`
      : undefined
    intelligence.confidence = 0
    intelligence.signals = []

    const runtimeMs = Date.now() - startedAt
    const enabledSources = Array.from(new Set([
      ...orchestration.diagnostics.managedSearch.configuredProviders,
      ...(orchestration.diagnostics.geminiGroundedSearch.configured ? ['gemini-google-search'] : []),
      ...(orchestration.diagnostics.legacyHtmlSearchEnabled
        ? plan.liveSources
        : plan.liveSources.filter(source => source === 'searxng')),
      ...(plan.useMemory ? ['memory'] : []),
    ]))
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
          enabledSources,
          lensRouting,
          intentGate: gated.diagnostics,
          procurementRescue,
          smartFilter: smartFilter.diagnostics,
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
              extraction_status: 'candidate',
              metadata: {
                lens: orchestration.lens,
                verificationStatus: 'candidate',
                retrieval: result.retrieval,
                validation: result.validation,
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
      requestedLens,
      summary: intelligence.summary,
      expandedQueries: orchestration.diagnostics.queryVariants
        .map(variant => variant.query)
        .filter(variant => variant.toLowerCase() !== orchestration.normalizedQuery.toLowerCase()),
      signals: [],
      results: responseResults,
      searchRunId,
      sources: orchestration.sources,
      timestamp: intelligence.timestamp,
      confidence: 0,
      intent: orchestration.diagnostics.semanticIntent,
      diagnostics: {
        runtimeMs,
        enabledSources,
        safeSearch: plan.safeSearch,
        failures: orchestration.failures,
        intentGate: gated.diagnostics,
        procurementRescue,
        smartFilter: smartFilter.diagnostics,
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
