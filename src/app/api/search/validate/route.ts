import { NextRequest } from 'next/server'
import { deepValidateResults, type DeepValidationEvent } from '../../../../lib/deep-validation'
import { indexResultsInPersistentMemory } from '../../../../lib/memory-indexing'
import { insertSearchResult } from '../../../../lib/search-storage'
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
}

function sseEvent(event: string, value: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`
}

function resultDomain(result: ScrapedResult): string {
  if (result.domain) return result.domain
  try { return new URL(result.url).hostname.replace(/^www\./, '') } catch { return 'unknown source' }
}

export function verifiedSearchSummary(query: string, lens: SearchLens, results: ScrapedResult[]): string {
  if (results.length === 0) {
    return `No destination page passed the complete-query evidence review for “${query}.” Try a broader location, date range, or related procurement term.`
  }
  const top = results.slice(0, 3)
    .map(result => `“${result.title.replace(/\s+/g, ' ').trim().slice(0, 100)}” (${resultDomain(result)})`)
    .join('; ')
  return `Verified ${results.length} destination page${results.length === 1 ? '' : 's'} for “${query}” using the ${lens} lens. Strongest evidence: ${top}.`
}

export function verifiedSearchConfidence(results: ScrapedResult[]): number {
  if (results.length === 0) return 0
  const averageRelevance = results.reduce(
    (total, result) => total + Math.max(0, Math.min(1, result.validation?.relevance || 0)),
    0
  ) / results.length
  const sourceCount = new Set(results.flatMap(result => result.retrieval?.sources || [result.source])).size
  const evidenceCount = results.reduce((total, result) => total + (result.pageValidation?.evidence.length || 0), 0)
  return Math.min(96, Math.round(
    averageRelevance * 72
    + Math.min(14, sourceCount * 4)
    + Math.min(10, evidenceCount * 2)
  ))
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
          results: verifiedResults,
          summary: verifiedSearchSummary(query, lens, verifiedResults),
          confidence: verifiedSearchConfidence(verifiedResults),
          lens,
          diagnostics: {
            ...outcome.diagnostics,
            verifiedOnly: true,
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
