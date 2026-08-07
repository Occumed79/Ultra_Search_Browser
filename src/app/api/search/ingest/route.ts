import { NextRequest, NextResponse } from 'next/server'
import type {
  BrowserSearchVariant,
  BrowserSerpCandidateInput,
} from '../../../../lib/browser-search-pipeline'
import { processSearchCandidates } from '../../../../lib/search-candidate-processing'

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: 'Search retrieval results are required' }, { status: 400 })
    }

    const payload = await processSearchCandidates({
      query,
      intent: body.intent,
      results: body.results,
      searches: body.searches,
      settings: body.settings,
      transport: 'searxng',
      retrievalMode: 'searxng-metasearch',
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
