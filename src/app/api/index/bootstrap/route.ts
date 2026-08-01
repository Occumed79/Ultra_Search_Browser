import { NextRequest, NextResponse } from 'next/server'
import {
  bootstrapProcurementIndex,
  getIndexStats,
  initializeSmallWeb,
} from '../../../../lib/small-web'
import { seedCatalogSummary } from '../../../../lib/procurement-index-seeds'
import { samApiKeyConfigured } from '../../../../lib/sam-gov-index'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: NextRequest): boolean {
  const secret = process.env.INDEX_BOOTSTRAP_SECRET || process.env.CRON_SECRET
  if (!secret) {
    return Boolean(process.env.DATABASE_URL)
  }
  const header = request.headers.get('authorization') || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const query = request.nextUrl.searchParams.get('secret') || ''
  return bearer === secret || query === secret
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        error: 'DATABASE_URL not configured',
        index: null,
        catalog: seedCatalogSummary(),
        samGov: { configured: samApiKeyConfigured() },
      },
      { status: 503 }
    )
  }
  try {
    await initializeSmallWeb()
    const stats = await getIndexStats()
    return NextResponse.json({
      ok: true,
      index: stats,
      catalog: seedCatalogSummary(),
      samGov: { configured: samApiKeyConfigured() },
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: message, catalog: seedCatalogSummary(), samGov: { configured: samApiKeyConfigured() } },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured — cannot write index' },
      { status: 503 }
    )
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  try {
    const result = await bootstrapProcurementIndex()
    return NextResponse.json({
      ok: true,
      seeded: result.seeded,
      feedsAttempted: result.fetch.feeds,
      entriesStored: result.fetch.entries,
      failures: result.fetch.failures,
      frJson: result.frJson,
      samGov: result.samGov,
      index: result.stats,
      catalog: seedCatalogSummary(),
      runtimeMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Index bootstrap failed:', error)
    return NextResponse.json(
      { error: 'Index bootstrap failed', detail: message },
      { status: 500 }
    )
  }
}
