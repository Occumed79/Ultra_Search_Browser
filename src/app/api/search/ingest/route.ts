import { NextRequest, NextResponse } from 'next/server'
import type {
  BrowserSearchVariant,
  BrowserSerpCandidateInput,
} from '../../../../lib/browser-search-pipeline'
import { createSearchTrace, finishSearchTrace, recordSearchFlightStage } from '../../../../lib/search-flight-recorder'
import {
  processSearchCandidates,
  type SearchRetrievalTransport,
} from '../../../../lib/search-candidate-processing'

const VALID_TRANSPORTS = new Set<SearchRetrievalTransport>([
  'searxng',
  'keenable',
  'zero-key-direct-rescue',
  'searxng+direct-rescue',
  'searxng+keenable',
  'keenable+direct-rescue',
  'searxng+keenable+direct-rescue',
  'fixture',
])

function inferTransport(
  requested: unknown,
  results: BrowserSerpCandidateInput[]
): SearchRetrievalTransport {
  if (typeof requested === 'string' && VALID_TRANSPORTS.has(requested as SearchRetrievalTransport)) {
    return requested as SearchRetrievalTransport
  }

  let hasSearxng = false
  let hasKeenable = false
  let hasRescue = false
  for (const result of results) {
    const source = typeof result.source === 'string' ? result.source.toLowerCase() : ''
    if (source.includes('searxng')) hasSearxng = true
    if (source.includes('keenable')) hasKeenable = true
    if (source.includes('direct rescue')) hasRescue = true
  }

  if (hasSearxng && hasKeenable && hasRescue) return 'searxng+keenable+direct-rescue'
  if (hasSearxng && hasKeenable) return 'searxng+keenable'
  if (hasSearxng && hasRescue) return 'searxng+direct-rescue'
  if (hasKeenable && hasRescue) return 'keenable+direct-rescue'
  if (hasKeenable) return 'keenable'
  if (hasRescue) return 'zero-key-direct-rescue'
  return 'searxng'
}

function retrievalModeFor(transport: SearchRetrievalTransport): string {
  if (transport === 'zero-key-direct-rescue') return 'zero-key-direct-rescue'
  if (transport === 'searxng+direct-rescue') return 'searxng-metasearch+direct-rescue'
  if (transport === 'keenable') return 'keenable-search'
  if (transport === 'searxng+keenable') return 'searxng-metasearch+keenable'
  if (transport === 'keenable+direct-rescue') return 'keenable+direct-rescue'
  if (transport === 'searxng+keenable+direct-rescue') return 'searxng-metasearch+keenable+direct-rescue'
  if (transport === 'fixture') return 'fixture'
  return 'searxng-metasearch'
}

function traceIdFromIntent(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const traceId = (value as { __traceId?: unknown }).__traceId
  return typeof traceId === 'string' && traceId.trim() ? traceId.trim().slice(0, 100) : undefined
}

export async function POST(request: NextRequest) {
  let traceId: string | undefined
  try {
    const body = (await request.json()) as {
      query?: string
      intent?: unknown
      results?: BrowserSerpCandidateInput[]
      searches?: BrowserSearchVariant[]
      settings?: unknown
      transport?: unknown
      traceId?: unknown
    }
    const query = body.query?.trim() || ''
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    if (!Array.isArray(body.results)) {
      return NextResponse.json({ error: 'Search retrieval results are required' }, { status: 400 })
    }

    traceId = createSearchTrace(
      query,
      typeof body.traceId === 'string' ? body.traceId : traceIdFromIntent(body.intent)
    )
    const transport = inferTransport(body.transport, body.results)
    recordSearchFlightStage(traceId, 'ingest.start', {
      transport,
      rawCandidateCount: body.results.length,
      plannedSearches: Array.isArray(body.searches) ? body.searches.length : 0,
    })

    const startedAt = Date.now()
    const payload = await processSearchCandidates({
      query,
      intent: body.intent,
      results: body.results,
      searches: body.searches,
      settings: body.settings,
      transport,
      retrievalMode: retrievalModeFor(transport),
      productMode: 'rfp-finder-multi-source',
      rawCandidateLabel: 'rawSearchCandidates',
    })
    const retainedCandidateCount = Array.isArray(payload.results) ? payload.results.length : 0

    recordSearchFlightStage(traceId, 'ingest.complete', {
      runtimeMs: Date.now() - startedAt,
      transport,
      rawCandidateCount: body.results.length,
      retainedCandidateCount,
      diagnostics: payload.diagnostics,
    })
    if (retainedCandidateCount === 0) {
      finishSearchTrace(traceId, 'complete', {
        terminalStage: 'ingest',
        rawCandidateCount: body.results.length,
        retainedCandidateCount: 0,
        reason: 'No candidates survived the procurement and Occu-Med candidate gates.',
      })
    }

    return NextResponse.json({ ...payload, traceId }, {
      headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Ultra-Search-Trace': traceId },
    })
  } catch (error) {
    finishSearchTrace(traceId, 'error', {
      stage: 'ingest',
      error: error instanceof Error ? error.message : String(error),
    })
    console.error('Search candidate ingestion failed:', error)
    return NextResponse.json(
      {
        error: 'Search result filtering failed',
        detail: error instanceof Error ? error.message : String(error),
        stage: 'multi-source-candidate-filter',
        traceId,
      },
      { status: 500, headers: traceId ? { 'X-Ultra-Search-Trace': traceId } : undefined }
    )
  }
}
