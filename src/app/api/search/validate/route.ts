import { NextRequest } from 'next/server'
import { deepValidateResults, type DeepValidationEvent } from '../../../../lib/deep-validation'
import { indexResultsInPersistentMemory } from '../../../../lib/memory-indexing'
import { applyOccuMedDecisionGate } from '../../../../lib/occumed-result-decision'
import { applyResultFeedbackRanking } from '../../../../lib/result-feedback-ranking'
import { coerceSemanticIntentPlan } from '../../../../lib/semantic-intent'
import { insertSearchResult } from '../../../../lib/search-storage'
import {
  verifiedSearchConfidence,
  verifiedSearchSummary,
} from '../../../../lib/verified-search-intelligence'
import { verifiedResultsOnly } from '../../../../lib/verified-results'
import type { ScrapedResult, SearchLens } from '../../../../types/search'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const VALID_LENSES = new Set<SearchLens>([
  'web', 'pdf', 'government', 'procurement', 'pricing', 'provider',
  'technical', 'news', 'legal', 'medical', 'academic', 'financial',
])
const PRODUCTION_SMOKE_QUERY = 'Occupational Health Services RFP production validation'

interface ValidationRequest {
  query?: string
  lens?: SearchLens
  results?: ScrapedResult[]
  maxTargets?: number
  intent?: unknown
  testMode?: boolean
}

type PersistableRfpResult = ScrapedResult & {
  rfpIntelligence?: unknown
  packageAnalysis?: unknown
  occuMedDecision?: unknown
}

function sseEvent(event: string, value: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`
}

async function persistVerifiedResults(results: ScrapedResult[], lens: SearchLens) {
  const persisted = await Promise.allSettled(results.slice(0, 30).map(rawResult => {
    const result = rawResult as PersistableRfpResult
    return insertSearchResult({
      url: result.url,
      normalized_url: result.url,
      domain: result.domain,
      title: result.title,
      snippet: result.description,
      source_engine: result.source,
      rank: result.rank,
      score: result.score,
      final_score: result.score,
      extraction_status: 'verified-page-and-package',
      extracted_text: [
        result.pageValidation?.evidence.join('\n'),
        result.rfpIntelligence ? JSON.stringify(result.rfpIntelligence) : '',
      ].filter(Boolean).join('\n'),
      metadata: {
        lens,
        verificationStatus: 'valid',
        verifiedAt: result.pageValidation?.checkedAt || new Date().toISOString(),
        retrieval: result.retrieval,
        validation: result.validation,
        pageValidation: result.pageValidation,
        entity: result.entity,
        rfpIntelligence: result.rfpIntelligence,
        packageAnalysis: result.packageAnalysis,
        occuMedDecision: result.occuMedDecision,
      },
    })
  }))

  return {
    attempted: results.length,
    persisted: persisted.filter(item => item.status === 'fulfilled' && item.value).length,
    failed: persisted.filter(item => item.status === 'rejected').length,
  }
}

function applyLearnedOrder<T extends { url: string }>(results: T[], learned: ScrapedResult[]): T[] {
  const rankByUrl = new Map(learned.map((result, index) => [result.url, { rank: index + 1, score: result.score }]))
  return results
    .map(result => {
      const adjustment = rankByUrl.get(result.url)
      return adjustment ? { ...result, score: adjustment.score, rank: adjustment.rank } : result
    })
    .sort((left, right) => (rankByUrl.get(left.url)?.rank || 9_999) - (rankByUrl.get(right.url)?.rank || 9_999))
}

function isProductionSmokeFixture(result: ScrapedResult): boolean {
  try {
    const url = new URL(result.url)
    return result.source === 'production-smoke'
      && url.pathname === '/search-validation-evidence.txt'
      && /^Synthetic Occupational Health Services RFP\b/i.test(result.title)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  let body: ValidationRequest
  try {
    body = await request.json() as ValidationRequest
  } catch {
    return Response.json({ error: 'Invalid JSON request' }, { status: 400 })
  }

  const query = body.query?.trim() || ''
  const requestedLens = body.lens && VALID_LENSES.has(body.lens) ? body.lens : 'procurement'
  const lens: SearchLens = 'procurement'
  const results = Array.isArray(body.results)
    ? body.results.filter(result => Boolean(result?.url && result?.title)).slice(0, 60)
    : []
  const maxTargets = Number.isFinite(Number(body.maxTargets))
    ? Math.max(1, Math.min(60, Number(body.maxTargets)))
    : undefined
  const testMode = body.testMode === true
    && query === PRODUCTION_SMOKE_QUERY
    && results.length === 1
    && results.every(isProductionSmokeFixture)

  if (!query) return Response.json({ error: 'Query is required' }, { status: 400 })
  if (results.length === 0) return Response.json({ error: 'At least one result is required' }, { status: 400 })
  const semanticIntent = coerceSemanticIntentPlan(body.intent, query, lens)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const write = (event: string, value: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseEvent(event, value)))
        } catch {
          closed = true
        }
      }

      write('ready', { query, lens, requestedLens, candidateCount: results.length, testMode })

      try {
        const rawOutcome = await deepValidateResults(query, lens, results, {
          maxTargets,
          semanticIntent,
          onEvent: async (event: DeepValidationEvent) => {
            if (event.type === 'complete') return
            // Progress is streamed, but individual candidate cards are not
            // promoted before the mandatory Occu-Med decision gate completes.
            if (event.type === 'progress') write(event.type, event)
          },
        })
        const outcome = applyOccuMedDecisionGate(rawOutcome)
        const learnedResults = await applyResultFeedbackRanking(outcome.results)
        outcome.results = learnedResults
        outcome.buckets.valid = applyLearnedOrder(outcome.buckets.valid, learnedResults)

        const verifiedResults = verifiedResultsOnly(outcome.buckets.valid)
        const persistence = testMode
          ? {
              persistentMemory: {
                skipped: true,
                reason: 'synthetic-production-validation',
              },
              verifiedPersistence: {
                attempted: 0,
                persisted: 0,
                failed: 0,
                skipped: true,
              },
            }
          : await (async () => {
              const [persistentMemory, verifiedPersistence] = await Promise.all([
                indexResultsInPersistentMemory(
                  verifiedResults,
                  lens,
                  Math.min(20, verifiedResults.length),
                  4_000
                ),
                persistVerifiedResults(verifiedResults, lens),
              ])
              return { persistentMemory, verifiedPersistence }
            })()

        write('complete', {
          ...outcome,
          results: outcome.results,
          summary: verifiedResults.length > 0
            ? verifiedSearchSummary(query, lens, verifiedResults)
            : 'No active procurement opportunities passed the complete-package, Occu-Med relevance, and expiration gates.',
          confidence: verifiedSearchConfidence(verifiedResults),
          lens,
          requestedLens,
          diagnostics: {
            ...outcome.diagnostics,
            verifiedOnly: true,
            verifiedCount: verifiedResults.length,
            pursuitLearningApplied: !testMode,
            productionValidationMode: testMode,
            persistentMemory: persistence.persistentMemory,
            verifiedPersistence: persistence.verifiedPersistence,
          },
        })
      } catch (error) {
        write('error', {
          error: 'Deep validation failed',
          detail: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (!closed) {
          closed = true
          controller.close()
        }
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
