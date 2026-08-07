import { NextRequest, NextResponse } from 'next/server'
import { buildBrowserSearchPlan } from '../../../../lib/browser-search-pipeline'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { query?: string; maxSearches?: number }
    const query = body.query?.trim() || ''
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })

    const plan = buildBrowserSearchPlan(query, body.maxSearches)
    return NextResponse.json(plan, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
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
