import { NextRequest, NextResponse } from 'next/server'
import { buildIntelligenceObject, classifyLens } from '../../../lib/intelligence'
import { applyResultFeedbackRanking } from '../../../lib/result-feedback-ranking'
import { orchestrateSearch } from '../../../lib/search-orchestrator'
import { buildSearchPlan } from '../../../lib/search-settings'
import { insertSearchResult, insertSearchRun } from '../../../lib/search-storage'
import { applySmartFilter } from '../../../lib/smart-filter'
import type { ScrapedResult, SearchLens } from '../../../types/search'

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

const PROCUREMENT_LANGUAGE = /\b(?:rfp|rfq|rft|request for proposals?|request for qualifications|solicitation|invitation for bids?|invitation to bid|notice inviting bids|competitive sealed proposals?|bid opportunity|procurement opportunity|contract opportunity|vendor opportunity|tender|proposal due|responses due|submission deadline|closing date)\b/i
const PROCUREMENT_PORTAL = /(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com|publicpurchase\.com|opengov\.com|vendorregistry\.com)/i
const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of',
  'on', 'or', 'the', 'to', 'with', 'services', 'service', 'rfp', 'rfq', 'rft',
  'request', 'proposal', 'proposals', 'solicitation', 'bid', 'procurement',
])

function effectiveLens(requestedLens: SearchLens, query: string): SearchLens {
  if (requestedLens !== 'web') return requestedLens
  const inferred = classifyLens(query)
  return inferred === 'web' ? requestedLens : inferred
}

function meaningfulSubjectTerms(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(term => term.length >= 3 && !QUERY_STOP_WORDS.has(term))
  ))
}

function subjectMatchRatio(query: string, result: ScrapedResult): number {
  const terms = meaningfulSubjectTerms(query)
  if (terms.length === 0) return 1
  const text = `${result.title} ${result.description} ${result.url}`.toLowerCase()
  const matched = terms.filter(term => text.includes(term)).length
  return matched / terms.length
}

export function filterIntentCandidates(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[]
): ScrapedResult[] {
  if (lens !== 'procurement') return results

  return results.filter(result => {
    const text = `${result.title} ${result.description} ${result.url} ${result.domain}`
    if (PROCUREMENT_LANGUAGE.test(text) || PROCUREMENT_PORTAL.test(text)) return true

    const isOfficialDocument = /\.pdf(?:$|[?#])/i.test(result.url)
      && /(?:\.gov|\.us)(?:\/|$)/i.test(result.domain || result.url)
    return isOfficialDocument && subjectMatchRatio(query, result) >= 0.5
  })
}

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
    const resolvedLens = effectiveLens(requestedLens, query)
    const plan = buildSearchPlan(body.settings)
    const orchestration = await orchestrateSearch(query, resolvedLens, plan)
    orchestration.results = filterIntentCandidates(
      orchestration.normalizedQuery,
      orchestration.lens,
      orchestration.results
    )

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

    const smartFilter = await applySmartFilter(
      orchestration.normalizedQuery,
      orchestration.lens,
      orchestration.results,
      plan.resultsPerPage,
      {
        useLocalTransformer: false,
        useExternalProviders: true,
      }
    )
    orchestration.results = await applyResultFeedbackRanking(smartFilter.results)

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

    // Candidate snippets are not evidence. The verified summary and confidence
    // are populated only after destination pages have been opened and reviewed.
    intelligence.summary = undefined
    intelligence.confidence = 0

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
          requestedLens,
          resolvedLens: orchestration.lens,
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
      diagnostics: {
        runtimeMs,
        requestedLens,
        resolvedLens: orchestration.lens,
        enabledSources: [...plan.liveSources, ...(plan.useMemory ? ['memory'] : [])],
        safeSearch: plan.safeSearch,
        failures: orchestration.failures,
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
