import { NextRequest, NextResponse } from 'next/server'
import {
  getSearchFlightRecord,
  recentSearchFlightRecords,
  searchFlightRecorderStats,
} from '../../../../lib/search-flight-recorder'
import { searchSourceHealthSnapshot } from '../../../../lib/search-source-health'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const traceId = request.nextUrl.searchParams.get('id')?.trim()
  const limit = Math.max(1, Math.min(50, Number(request.nextUrl.searchParams.get('limit') || 20)))

  if (traceId) {
    const trace = getSearchFlightRecord(traceId)
    if (!trace) {
      return NextResponse.json({ error: 'Search trace not found' }, {
        status: 404,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      })
    }
    return NextResponse.json({ trace, sourceHealth: searchSourceHealthSnapshot() }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  }

  return NextResponse.json({
    traces: recentSearchFlightRecords(limit),
    stats: searchFlightRecorderStats(),
    sourceHealth: searchSourceHealthSnapshot(),
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
