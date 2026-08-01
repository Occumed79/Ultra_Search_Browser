import { NextRequest, NextResponse } from 'next/server'
import { buildIntelligenceObject } from '../../../lib/intelligence'
import { applyOccuMedSmartFilter } from '../../../lib/occumed-smart-filter'
import { rescueProcurementCandidates, type ProcurementRescueDiagnostics } from '../../../lib/procurement-rescue'
import { applyResultFeedbackRanking } from '../../../lib/result-feedback-ranking'
import { applyIntentCandidateGate } from '../../../lib/search-intent-gate'
import { orchestrateSearch } from '../../../lib/search-orchestrator'
import { buildSearchPlan } from '../../../lib/search-settings'
import { insertSearchResult, insertSearchRun } from '../../../lib/search-storage'
import type { ScrapedResult, SearchLens } from '../../../types/search'

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
  const merged = new Map<string, ScrapedResult>()

  for (const result of resultSets.flat()) {
    const normalizedUrl = normalizeUrl(result.url)
    const key = normalizedUrl.toLowerCase()
    if (!key) continue

    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...result, url: normalizedUrl })
      continue
    }

    merged.set(key, {
      ...(existing.score >= result.score ? existing : result),
      url: normalizedUrl,
      description: existing.description.length >= result.description.length
        ? existing.description
        : result.description,
      retrieval: {
        sources: Array.from(new Set([
          ...(existing.retrieval?.sources || [existing.source]),
          ...(result.retrieval?.sources || [result.source]),
        ])),
        queries: Array.from(new Set([
          ...(existing.retrieval?.queries || []),
          ...(result.retrieval?.queries || []),
        ])),
        purposes: Array.from(new Set([
          ...(existing.retrieval?.purposes || []),
          ...(result.retrieval?.purposes || []),
        ])),
        overlap: new Set([
          ...(existing.retrieval?.sources || [existing.source]),
          ...(result.retrieval?.sources || [result.source]),
        ]).size,
      },
    })
  }

  return Array.from(merged.values()).map((result, index) => ({
    ...result,
    rank: index + 1,
  }))
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const body = (await request.json()) as { query?: string; settings?: unknown }
    const query = body.query?.trim() || ''

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // This application is now an RFP Finder. Every search uses the procurement
    // lens while preserving the user's exact subject, geography, and exclusions.
    const requestedLens: SearchLens = 'procurement'
    const plan = buildSearchPlan(body.settings)
    const orchestration = await orchestrateSearch(query, requestedLens, plan)
    const lensRouting = orchestration.diagnostics.lensRouting

    const initialGate = applyIntentCandidateGate(
      orchestration.normalizedQuery,
      'procurement',
      orchestration.results,
      orchestration.diagnostics.semanticIntent
    )

    // Search focused procurement variants across independent public web indexes
    // on every request. Managed APIs have already run in the orchestrator, so
    // rescue avoids repeating them and wasting limited trial quota.
    const rescued = await rescueProcurementCandidates(orchestration.normalizedQuery, {
      safeSearch: plan.safeSearch,
      preferredLanguage: plan.preferredLanguage,
      region: plan.region,
      semanticIntent: orchestration.diagnostics.semanticIntent,
      skipManagedSearch: true,
    })
    const procurementRescue: ProcurementRescueDiagnostics = rescued.diagnostics

    const combinedCandidates = mergeUniqueResults([
      initialGate.results,
      rescued.results,
    ])
    const finalGate = applyIntentCandidateGate(
      orchestration.normalizedQuery,
      'procurement',
      combinedCandidates,
      orchestration.diagnostics.semanticIntent
    )
    orchestration.results = finalGate.results

    if (rescued.results.length > 0) {
      orchestration.sources = Array.from(new Set([
        ...orchestration.sources,
        ...rescued.results.map(result => `${result.source} · public-web-rfp`),
      ]))
    }
    if (rescued.diagnostics.failures.length > 0) {
      orchestration.failures.push(...rescued.diagnostics.failures.map(error => `public web RFP search: ${error}`))
    }

    const noExternalResults = orchestration.diagnostics.successfulLiveTasks === 0
      && orchestration.diagnostics.memoryKeywordMatches === 0
      && orchestration.diagnostics.memoryVectorMatches === 0
      && orchestration.diagnostics.smallWebMatches === 0
      && orchestration.diagnostics.marginaliaMatches === 0
      && procurementRescue.successfulTasks === 0

    if (orchestration.results.length === 0 && noExternalResults && orchestration.failures.length > 0) {
      const failureSummary = [
        ...orchestration.diagnostics.sourceRuns
          .filter(run => run.status === 'failed')
          .slice(0, 5)
          .map(run => `${run.source}: ${run.error || 'request failed'}`),
        ...procurementRescue.failures.slice(0, 5),
      ].join('; ')

      return NextResponse.json(
        {
          error: 'All retrieval sources failed',
          detail: failureSummary
            ? `The public-web RFP search could not retrieve usable pages. ${failureSummary}`
            : 'The public-web RFP search could not retrieve usable pages.',
          query: orchestration.normalizedQuery,
          lens: 'procurement',
          diagnostics: {
            ...orchestration.diagnostics,
            lensRouting,
            intentGate: finalGate.diagnostics,
            procurementRescue,
          },
        },
        { status: 502 }
      )
    }

    const smartFilter = await applyOccuMedSmartFilter(
      orchestration.normalizedQuery,
      'procurement',
      orchestration.results,
      plan.resultsPerPage,
      {
        useLocalTransformer: false,
        useExternalProviders: false,
        semanticIntent: orchestration.diagnostics.semanticIntent,
      }
    )
    orchestration.results = await applyResultFeedbackRanking(smartFilter.results)

    const noteParts = [
      `${finalGate.diagnostics.rejected + initialGate.diagnostics.rejected} candidates were excluded because they lacked procurement evidence or did not match the requested subject.`,
      `The public-web RFP pass attempted ${procurementRescue.attemptedTasks} targeted searches across independent indexes and retained ${procurementRescue.retainedCandidates} relevant candidates.`,
      orchestration.failures.length > 0
        ? `${orchestration.failures.length} retrieval tasks failed or returned unusable pages; successful sources were preserved.`
        : undefined,
    ].filter(Boolean)

    const intelligence = buildIntelligenceObject(
      orchestration.normalizedQuery,
      orchestration.expanded,
      orchestration.sources,
      orchestration.rawTexts,
      noteParts.join(' ') || undefined
    )

    intelligence.summary = orchestration.results.length === 0
      ? 'No relevant RFP, RFQ, solicitation, tender, bid, or comparable procurement notice was found after searching the public web and excluding generic or unrelated pages.'
      : undefined
    intelligence.confidence = 0
    intelligence.signals = []

    const runtimeMs = Date.now() - startedAt
    const enabledSources = Array.from(new Set([
      ...orchestration.diagnostics.managedSearch.configuredProviders,
      ...(orchestration.diagnostics.geminiGroundedSearch.configured ? ['gemini-google-search'] : []),
      'bing-rss',
      'duckduckgo-lite',
      'mojeek',
      'yahoo',
      'brave',
      ...(orchestration.diagnostics.legacyHtmlSearchEnabled
        ? plan.liveSources
        : plan.liveSources.filter(source => source === 'searxng')),
      ...(plan.useMemory ? ['memory'] : []),
    ]))
    let searchRunId: string | null = null
    const persistedResultIds = new Map<string, string>()

    try {
      searchRunId = await insertSearchRun({
        vertical: 'procurement',
        query,
        normalized_query: orchestration.normalizedQuery,
        lens: 'procurement',
        result_count: orchestration.results.length,
        runtime_ms: runtimeMs,
        sources: orchestration.sources,
        operators: {
          parsed: orchestration.operators,
          variants: orchestration.diagnostics.queryVariants,
          failures: orchestration.failures,
          enabledSources,
          lensRouting,
          intentGate: finalGate.diagnostics,
          procurementRescue,
          smartFilter: smartFilter.diagnostics,
          productMode: 'rfp-finder-www',
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
                lens: 'procurement',
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
      lens: 'procurement',
      requestedLens,
      summary: intelligence.summary,
      expandedQueries: Array.from(new Set([
        ...orchestration.diagnostics.queryVariants.map(variant => variant.query),
        ...procurementRescue.queries,
      ])).filter(variant => variant.toLowerCase() !== orchestration.normalizedQuery.toLowerCase()),
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
        intentGate: finalGate.diagnostics,
        procurementRescue,
        smartFilter: smartFilter.diagnostics,
        productMode: 'rfp-finder-www',
        ...orchestration.diagnostics,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown search failure'
    console.error('RFP Finder API failure:', error)

    return NextResponse.json(
      {
        error: 'RFP search failed',
        detail: message,
        stage: 'public-web-rfp-search',
      },
      { status: 500 }
    )
  }
}
