import { NextRequest, NextResponse } from 'next/server'
import {
  searchBingHTML,
  searchDuckDuckGo,
  searchGoogleScrape,
} from '../../../lib/search'
import {
  buildIntelligenceObject,
  expandQuery,
  scoreSignals,
} from '../../../lib/intelligence'
import {
  dedupeByUrl,
  keywordSearchStoredResults,
  vectorSearchStoredResults,
} from '../../../lib/memory-retrieval'
import { insertSearchResult, insertSearchRun } from '../../../lib/search-storage'
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

const REQUEST_TIMEOUT_MS = 9_000
const MEMORY_TIMEOUT_MS = 4_000
const MAX_RESULTS = 60

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function lensBonus(result: ScrapedResult, lens: SearchLens): number {
  const haystack = `${result.title} ${result.description} ${result.url}`.toLowerCase()
  let bonus = 0

  if (['government', 'procurement', 'pdf'].includes(lens)) {
    if (/\.gov\b|\.us\b/.test(result.domain.toLowerCase())) bonus += 35
    if (/\.pdf(?:$|\?)/.test(result.url.toLowerCase())) bonus += 35
  }

  if (lens === 'procurement' && /rfp|rfq|bid|solicitation|tender|procurement|proposal/.test(haystack)) {
    bonus += 30
  }

  if (lens === 'pricing' && /price|pricing|fee|rate|cost|self-pay|cash pay/.test(haystack)) {
    bonus += 25
  }

  if (lens === 'provider' && /clinic|provider|medical center|occupational health|occupational medicine/.test(haystack)) {
    bonus += 25
  }

  return bonus
}

function scoreAndRank(results: ScrapedResult[], lens: SearchLens): ScrapedResult[] {
  const scored = results
    .filter(result => Boolean(result.url && result.title))
    .map((result, index) => {
      const signalScore = scoreSignals(
        `${result.title} ${result.description || ''}`,
        result.url
      ).reduce((total, signal) => total + signal.score, 0)

      return {
        ...result,
        score: Math.max(0, 100 - index + signalScore + lensBonus(result, lens)),
      }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RESULTS)

  return scored.map((result, index) => ({ ...result, rank: index + 1 }))
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const body = (await request.json()) as { query?: string; lens?: SearchLens }
    const query = body.query?.trim() || ''

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const requestedLens = body.lens
    const lens: SearchLens = requestedLens && VALID_LENSES.has(requestedLens)
      ? requestedLens
      : 'web'

    const expanded = expandQuery(query, lens)
    const candidateQueries = Array.from(new Set([
      query,
      expanded.expansions[0],
      expanded.withOperators[0],
    ].filter((value): value is string => Boolean(value)))).slice(0, 3)

    const engines = [
      { name: 'DuckDuckGo', run: searchDuckDuckGo },
      { name: 'Bing', run: searchBingHTML },
      { name: 'Google', run: searchGoogleScrape },
    ]

    const liveJobs = candidateQueries.flatMap(candidateQuery =>
      engines.map(engine =>
        withTimeout(
          engine.run(candidateQuery),
          REQUEST_TIMEOUT_MS,
          `${engine.name} search`
        ).then(data => ({
          engine: engine.name,
          query: candidateQuery,
          data,
        }))
      )
    )

    const memoryKeywordPromise = withTimeout(
      keywordSearchStoredResults(query, lens, undefined, 20),
      MEMORY_TIMEOUT_MS,
      'keyword memory search'
    ).catch(() => [] as ScrapedResult[])

    const memoryVectorPromise = withTimeout(
      vectorSearchStoredResults(query, lens, 10),
      MEMORY_TIMEOUT_MS,
      'vector memory search'
    ).catch(() => [] as ScrapedResult[])

    const [liveSettled, memoryKeyword, memoryVector] = await Promise.all([
      Promise.allSettled(liveJobs),
      memoryKeywordPromise,
      memoryVectorPromise,
    ])

    const liveResults: ScrapedResult[] = []
    const rawTexts: string[] = []
    const sources: string[] = []
    const failures: string[] = []

    for (const result of liveSettled) {
      if (result.status === 'fulfilled') {
        const { engine, query: engineQuery, data } = result.value
        liveResults.push(...data.results)
        if (data.text.trim()) rawTexts.push(data.text)
        sources.push(`${engine} (${engineQuery.slice(0, 60)})`)
      } else {
        failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
      }
    }

    const mergedResults = scoreAndRank(
      dedupeByUrl([...liveResults, ...memoryKeyword, ...memoryVector]),
      lens
    )

    const intelligence = buildIntelligenceObject(
      query,
      expanded,
      sources,
      rawTexts,
      failures.length > 0 ? `${failures.length} source requests did not respond in time.` : undefined
    )

    const runtimeMs = Date.now() - startedAt

    let searchRunId: string | null = null
    const persistedResultIds = new Map<string, string>()

    try {
      searchRunId = await insertSearchRun({
        vertical: lens,
        query,
        normalized_query: query,
        lens,
        result_count: mergedResults.length,
        runtime_ms: runtimeMs,
        sources,
        operators: { candidateQueries, failures },
      })

      if (searchRunId) {
        const persisted = await Promise.allSettled(
          mergedResults.slice(0, 30).map(async result => {
            const id = await insertSearchResult({
              search_run_id: searchRunId as string,
              url: result.url,
              domain: result.domain,
              title: result.title,
              snippet: result.description,
              source_engine: result.source,
              rank: result.rank,
              score: result.score,
              final_score: result.score,
              extraction_status: 'search-result',
              metadata: { lens },
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

    const responseResults = mergedResults.map(result => ({
      ...result,
      id: persistedResultIds.get(result.url),
    }))

    return NextResponse.json({
      query: intelligence.query,
      lens: intelligence.lens,
      summary: intelligence.summary,
      expandedQueries: intelligence.queryExpansions,
      signals: intelligence.signals,
      results: responseResults,
      searchRunId,
      sources: intelligence.sources,
      timestamp: intelligence.timestamp,
      confidence: intelligence.confidence,
      diagnostics: {
        runtimeMs,
        attemptedRequests: liveJobs.length,
        successfulRequests: liveSettled.filter(result => result.status === 'fulfilled').length,
        failedRequests: failures.length,
        memoryKeywordMatches: memoryKeyword.length,
        memoryVectorMatches: memoryVector.length,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown search failure'
    console.error('Search API failure:', error)

    return NextResponse.json(
      {
        error: 'Search failed',
        detail: message,
        stage: 'search-api',
      },
      { status: 500 }
    )
  }
}
