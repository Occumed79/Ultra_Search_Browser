import { NextRequest, NextResponse } from 'next/server'
import type {
  BrowserSearchVariant,
  BrowserSerpCandidateInput,
} from '../../../../lib/browser-search-pipeline'
import {
  processSearchCandidates,
  type SearchRetrievalTransport,
} from '../../../../lib/search-candidate-processing'

const VALID_TRANSPORTS = new Set<SearchRetrievalTransport>([
  'searxng',
  'zero-key-direct-rescue',
  'searxng+direct-rescue',
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
  let hasRescue = false
  for (const result of results) {
    const source = typeof result.source === 'string' ? result.source.toLowerCase() : ''
    if (source.includes('searxng')) hasSearxng = true
    if (source.includes('direct rescue')) hasRescue = true
  }

  if (hasSearxng && hasRescue) return 'searxng+direct-rescue'
  if (hasRescue) return 'zero-key-direct-rescue'
  return 'searxng'
}

function retrievalModeFor(transport: SearchRetrievalTransport): string {
  if (transport === 'zero-key-direct-rescue') return 'zero-key-direct-rescue'
  if (transport === 'searxng+direct-rescue') return 'searxng-metasearch+direct-rescue'
  if (transport === 'fixture') return 'fixture'
  return 'searxng-metasearch'
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      query?: string
      intent?: unknown
      results?: BrowserSerpCandidateInput[]
      searches?: BrowserSearchVariant[]
      settings?: unknown
      transport?: unknown
    }
    const query = body.query?.trim() || ''
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    if (!Array.isArray(body.results)) {
      return NextResponse.json({ error: 'Search retrieval results are required' }, { status: 400 })
    }

    const transport = inferTransport(body.transport, body.results)
    const payload = await processSearchCandidates({
      query,
      intent: body.intent,
      results: body.results,
      searches: body.searches,
      settings: body.settings,
      transport,
      retrievalMode: retrievalModeFor(transport),
      productMode: 'rfp-finder-searxng',
      rawCandidateLabel: 'rawSearchCandidates',
    })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (error) {
    console.error('Search candidate ingestion failed:', error)
    return NextResponse.json(
      {
        error: 'Search result filtering failed',
        detail: error instanceof Error ? error.message : String(error),
        stage: 'searxng-candidate-filter',
      },
      { status: 500 }
    )
  }
}
