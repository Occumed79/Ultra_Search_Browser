import { NextRequest, NextResponse } from 'next/server'
import { applyOccuMedSmartFilter } from '../../../../lib/occumed-smart-filter'
import {
  coerceBrowserIntent,
  normalizeBrowserSerpCandidates,
  type BrowserSearchVariant,
  type BrowserSerpCandidateInput,
} from '../../../../lib/browser-search-pipeline'
import { applyResultFeedbackRanking } from '../../../../lib/result-feedback-ranking'
import { applyIntentCandidateGate } from '../../../../lib/search-intent-gate'
import { buildSearchPlan } from '../../../../lib/search-settings'
import { insertSearchResult, insertSearchRun } from '../../../../lib/search-storage'

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const body = (await request.json()) as {
      query?: string
      intent?: unknown
      results?: BrowserSerpCandidateInput[]
      searches?: BrowserSearchVariant[]
      settings?: unknown
    }
    const query = body.query?.trim() || ''
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    if (!Array.isArray(body.results)) {
      return NextResponse.json({ error: 'Browser search results are required' }, { status: 400 })
    }

    const plan = buildSearchPlan(body.settings)
    const intent = coerceBrowserIntent(body.intent, query)
    const normalizedCandidates = normalizeBrowserSerpCandidates(body.results)
    const intentGate = applyIntentCandidateGate(query, 'procurement', normalizedCandidates, intent)
    const smartFilter = await applyOccuMedSmartFilter(
      query,
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
      console.warn('Browser-fed feedback reranking failed; preserving locally filtered order:', error)
    }

    const sources = uniqueStrings(normalizedCandidates.flatMap(result => result.retrieval?.sources || [result.source]))
    const expandedQueries = uniqueStrings((body.searches || []).map(search => search.query))
      .filter(value => value.toLowerCase() !== query.toLowerCase())
    const runtimeMs = Date.now() - startedAt
    let searchRunId: string | null = null
    const persistedResultIds = new Map<string, string>()

    try {
      searchRunId = await insertSearchRun({
        vertical: 'procurement',
        query,
        normalized_query: query,
        lens: 'procurement',
        result_count: rankedResults.length,
        runtime_ms: runtimeMs,
        sources,
        operators: {
          transport: 'browser-extension',
          apiKeysRequired: false,
          browserSearches: body.searches || [],
          rawBrowserCandidates: normalizedCandidates.length,
          intentGate: intentGate.diagnostics,
          smartFilter: smartFilter.diagnostics,
          productMode: 'rfp-finder-browser-fed',
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
                transport: 'browser-extension',
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
    } catch (error) {
      console.warn('Browser-fed search persistence failed:', error)
    }

    const results = rankedResults.map(result => ({
      ...result,
      id: persistedResultIds.get(result.url),
    }))

    return NextResponse.json({
      query,
      lens: 'procurement',
      requestedLens: 'procurement',
      summary: results.length === 0
        ? 'The browser search completed, but the Occu-Med relevance gate discarded every raw result as irrelevant, generic, or insufficiently procurement-specific.'
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
        retrievalMode: 'browser-fed',
        apiKeysRequired: false,
        rawBrowserCandidates: normalizedCandidates.length,
        intentGate: intentGate.diagnostics,
        smartFilter: smartFilter.diagnostics,
        productMode: 'rfp-finder-browser-fed',
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Browser SERP ingestion failed:', error)
    return NextResponse.json(
      {
        error: 'Browser search filtering failed',
        detail: error instanceof Error ? error.message : String(error),
        stage: 'browser-serp-filter',
      },
      { status: 500 }
    )
  }
}
