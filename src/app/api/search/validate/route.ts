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
const VERIFIED_FEEDBACK_BUDGET_MS = 2_000
const VERIFIED_PERSISTENCE_BUDGET_MS = 3_500

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

function withBudget<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms budget`)), timeoutMs)
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

async function persistVerifiedResults(results: ScrapedResult[], lens: SearchLens) {
  const selected = results.slice(0, 30)
  const persisted = await Promise.allSettled(selected.map(rawResult => {
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

  const persistedCount = persisted.filter(item => item.status === 'fulfilled' && item.value).length
  return {
    attempted: selected.length,
    persisted: persistedCount,
    failed: selected.length - persistedCount,
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
            if (event.type === 'progress') write(event.type, event)
          },
        })
        const outcome = applyOccuMedDecisionGate(rawOutcome)

        let pursuitLearningApplied = false
        if (!testMode && outcome.results.length > 0) {
          try {
            const learnedResults = await withBudget(
              applyResultFeedbackRanking(outcome.results),
              VERIFIED_FEEDBACK_BUDGET_MS,
              'Verified feedback reranking'
            )
            outcome.results = learnedResults
            outcome.buckets.valid = applyLearnedOrder(outcome.buckets.valid, learnedResults)
            pursuitLearningApplied = true
          } catch (error) {
            console.warn('Verified feedback reranking failed or timed out; preserving evidence rank:', error)
          }
        }

        const verifiedResults = verifiedResultsOnly(outcome.buckets.valid)
        let persistenceTimedOut = false
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
              try {
                const [persistentMemory, verifiedPersistence] = await withBudget(
                  Promise.all([
                    indexResultsInPersistentMemory(
                      verifiedResults,
                      lens,
                      Math.min(20, verifiedResults.length),
                      3_000
                    ),
                    persistVerifiedResults(verifiedResults, lens),
                  ]),
                  VERIFIED_PERSISTENCE_BUDGET_MS,
                  'Verified persistence'
                )
                return { persistentMemory, verifiedPersistence }
              } catch (error) {
                persistenceTimedOut = /exceeded .* budget/i.test(error instanceof Error ? error.message : String(error))
                console.warn('Verified persistence failed or timed out; completing evidence response:', error)
                return {
                  persistentMemory: {
                    skipped: true,
                    reason: persistenceTimedOut ? 'persistence-budget-exceeded' : 'persistence-failed',
                  },
                  verifiedPersistence: {
                    attempted: Math.min(30, verifiedResults.length),
                    persisted: 0,
                    failed: Math.min(30, verifiedResults.length),
                    skipped: true,
                    timedOut: persistenceTimedOut,
                  },
                }
              }
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
            pursuitLearningApplied,
            pursuitLearningSkipped: testMode,
            productionValidationMode: testMode,
            persistenceTimedOut,
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
