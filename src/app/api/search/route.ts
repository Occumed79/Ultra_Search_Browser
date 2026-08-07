import { NextRequest, NextResponse } from 'next/server'
import { buildBrowserSearchPlan } from '../../../lib/browser-search-pipeline'

/**
 * Compatibility endpoint.
 *
 * Ultra Search intentionally no longer acts as a server-side search engine.
 * Search-engine retrieval belongs to the user's browser companion. The app
 * builds a deterministic Occu-Med query plan at /api/search/plan and accepts
 * visible SERP cards at /api/search/ingest.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { query?: string }
    const query = body.query?.trim() || ''
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })

    const plan = buildBrowserSearchPlan(query)
    return NextResponse.json({
      error: 'Browser search results required',
      code: 'BROWSER_RESULTS_REQUIRED',
      detail: 'Ultra Search no longer retrieves search-engine results from Render. Run the returned plan through the Ultra Search Browser Companion and POST the resulting SERP cards to /api/search/ingest.',
      query: plan.query,
      lens: plan.lens,
      intent: plan.intent,
      searches: plan.searches,
      transport: plan.transport,
      apiKeysRequired: false,
      timestamp: plan.timestamp,
    }, {
      status: 428,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    return NextResponse.json({
      error: 'Browser search planning failed',
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
