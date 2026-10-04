import { NextRequest, NextResponse } from 'next/server'
import { ensureRelevanceProfile } from '../../../lib/canonical-relevance'
import { buildBrowserSearchPlan } from '../../../lib/browser-search-pipeline'
import { coercePlan, executeSearchRetrieval, traceIdFromPlan } from '../../../lib/search-retrieval'
import { finishSearchTrace } from '../../../lib/search-flight-recorder'

export async function POST(request: NextRequest) {
  let traceId: string | undefined
  try {
    const body = await request.json() as { query?: unknown; plan?: unknown; traceId?: unknown }
    await ensureRelevanceProfile()
    const suppliedPlan = coercePlan(body.plan)
    const query = suppliedPlan?.query || (typeof body.query === 'string' ? body.query.trim() : '')
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    const plan = suppliedPlan || buildBrowserSearchPlan(query, 12)
    plan.traceId = traceIdFromPlan(body.plan) || (typeof body.traceId === 'string' ? body.traceId : undefined)
    const batch = await executeSearchRetrieval(plan, { signal: request.signal })
    traceId = batch.traceId
    if (batch.results.length === 0) {
      finishSearchTrace(traceId, 'error', { stage: 'retrieval', reason: 'no-candidates', transport: batch.transport })
      const configured = Object.values(batch.configuredSources).some(Boolean)
      return NextResponse.json({
        ...batch,
        error: 'Search retrieval returned no candidates',
        code: configured ? 'SEARCH_SOURCES_EMPTY' : 'SEARXNG_UNAVAILABLE',
        detail: 'All live-web discovery sources and bounded direct-engine rescue returned no usable search results.',
      }, { status: 502, headers: { 'X-Ultra-Search-Trace': traceId } })
    }
    return NextResponse.json(batch, {
      headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Ultra-Search-Trace': traceId },
    })
  } catch (error) {
    finishSearchTrace(traceId, 'error', { stage: 'retrieval', error: String(error) })
    return NextResponse.json({ error: 'Search retrieval failed', detail: String(error), traceId, apiKeysRequired: false }, { status: 500 })
  }
}
