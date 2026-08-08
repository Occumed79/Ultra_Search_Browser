import { NextRequest, NextResponse } from 'next/server'
import { buildBrowserSearchPlan } from '../../../../lib/browser-search-pipeline'
import { createSearchTrace, recordSearchFlightStage } from '../../../../lib/search-flight-recorder'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { query?: string; maxSearches?: number; traceId?: string }
    const query = body.query?.trim() || ''
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })

    const traceId = createSearchTrace(query, body.traceId)
    const plan = { ...buildBrowserSearchPlan(query, body.maxSearches), traceId }
    recordSearchFlightStage(traceId, 'plan.complete', {
      query: plan.query,
      searchCount: plan.searches.length,
      purposes: plan.searches.map(search => search.purpose),
      apiKeysRequired: plan.apiKeysRequired,
      transport: plan.transport,
    })

    return NextResponse.json(plan, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Ultra-Search-Trace': traceId,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Search planning failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
