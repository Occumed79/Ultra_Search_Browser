import { NextRequest } from 'next/server'
import { deepValidateResults, type DeepValidationEvent } from '../../../../lib/deep-validation'
import { indexResultsInPersistentMemory } from '../../../../lib/memory-indexing'
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

interface ValidationRequest {
  query?: string
  lens?: SearchLens
  results?: ScrapedResult[]
  maxTargets?: number
  intent?: unknown
}

function sseEvent(event: string, value: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`
}

async function persistVerifiedResults(results: ScrapedResult[], lens: SearchLens) {
  const persisted = await Promise.allSettled(results.slice(0, 30).map(result => insertSearchResult({
    url: result.url,
    normalized_url: result.url,
    domain: result.domain,
    title: result.title,
    snippet: result.description,
    source_engine: result.source,
    rank: result.rank,
    score: result.score,
    final_score: result.score,
    extraction_status: 'verified-page',
    extracted_text: result.pageValidation?.evidence.join('\n') || result.description,
    metadata: {
      lens,
      verificationStatus: 'valid',
      verifiedAt: result.pageValidation?.checkedAt || new Date().toISOString(),
      retrieval: result.retrieval,
      validation: result.validation,
      pageValidation: result.pageValidation,
      entity: result.entity,
    },
  })))

  return {
    attempted: results.length,
    persisted: persisted.filter(item => item.status === 'fulfilled' && item.value).length,
    failed: persisted.filter(item => item.status === 'rejected').length,
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
  const lens = body.lens && VALID_LENSES.has(body.lens) ? body.lens : 'web'
  const results = Array.isArray(body.results)
    ? body.results.filter(result => Boolean(result?.url && result?.title)).slice(0, 60)
    : []
  const maxTargets = Number.isFinite(Number(body.maxTargets))
    ? Math.max(1, Math.min(30, Number(body.maxTargets)))
    : undefined

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

      write('ready', { query, lens, candidateCount: results.length })

      try {
        const outcome = await deepValidateResults(query, lens, results, {
          maxTargets,
          semanticIntent,
          onEvent: async (event: DeepValidationEvent) => {
            if (event.type === 'complete') return
            write(event.type, event)
          },
        })
        const verifiedResults = verifiedResultsOnly(outcome.buckets.valid)
        const [persistentMemory, verifiedPersistence] = await Promise.all([
          indexResultsInPersistentMemory(
            verifiedResults,
            lens,
            Math.min(16, verifiedResults.length),
            4_000
          ),
          persistVerifiedResults(verifiedResults, lens),
        ])
        write('complete', {
          ...outcome,
          // Keep useful but unverifiable results in the primary list. A site
          // blocking server-side fetches is not evidence that the search
          // result itself is irrelevant.
          results: outcome.results,
          summary: verifiedSearchSummary(query, lens, verifiedResults),
          confidence: verifiedSearchConfidence(verifiedResults),
          lens,
          diagnostics: {
            ...outcome.diagnostics,
            verifiedOnly: false,
            verifiedCount: verifiedResults.length,
            persistentMemory,
            verifiedPersistence,
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
