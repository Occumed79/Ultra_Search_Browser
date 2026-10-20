import { NextRequest, NextResponse } from 'next/server'
import {
  bootstrapProcurementIndex,
  getIndexStats,
  initializeSmallWeb,
} from '../../../../lib/small-web'
import { seedCatalogSummary } from '../../../../lib/procurement-index-seeds'
import { samApiKeyConfigured } from '../../../../lib/sam-gov-index'
import {
  clearAllEntries,
  pruneNonOccuMedEntries,
  wipeIndex,
} from '../../../../lib/index-prune'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: NextRequest): boolean {
  const secret = process.env.INDEX_BOOTSTRAP_SECRET || process.env.CRON_SECRET
  // Fail closed: no maintenance API mutations are permitted unless an
  // explicit server-side secret exists. Never accept secrets in URL queries.
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
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
      modes: {
        default: 'POST /api/index/bootstrap — refresh Occu-Med feeds',
        prune: 'POST ?mode=prune — delete non–Occu-Med entries',
        clear: 'POST ?mode=clear — delete all entries, keep sources',
        wipe: 'POST ?mode=wipe — delete all entries and sources',
        rebuild: 'POST ?mode=rebuild — wipe then bootstrap',
      },
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
  if (!process.env.INDEX_BOOTSTRAP_SECRET?.trim() && !process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { error: 'Index maintenance is disabled until INDEX_BOOTSTRAP_SECRET or CRON_SECRET is configured' },
      { status: 503 }
    )
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const mode = (request.nextUrl.searchParams.get('mode') || 'refresh').toLowerCase()

  try {
    await initializeSmallWeb()

    if (mode === 'prune') {
      const pruned = await pruneNonOccuMedEntries()
      return NextResponse.json({
        ok: true,
        mode: 'prune',
        scanned: pruned.scanned,
        deleted: pruned.deleted,
        kept: pruned.kept,
        index: pruned.stats,
        runtimeMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      })
    }

    if (mode === 'clear') {
      const cleared = await clearAllEntries()
      return NextResponse.json({
        ok: true,
        mode: 'clear',
        deleted: cleared.deleted,
        index: cleared.stats,
        runtimeMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      })
    }

    if (mode === 'wipe') {
      const wiped = await wipeIndex()
      return NextResponse.json({
        ok: true,
        mode: 'wipe',
        entriesDeleted: wiped.entriesDeleted,
        sourcesDeleted: wiped.sourcesDeleted,
        index: wiped.stats,
        runtimeMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      })
    }

    if (mode === 'rebuild') {
      const wiped = await wipeIndex()
      const result = await bootstrapProcurementIndex()
      return NextResponse.json({
        ok: true,
        mode: 'rebuild',
        wiped: {
          entriesDeleted: wiped.entriesDeleted,
          sourcesDeleted: wiped.sourcesDeleted,
        },
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
    }

    // default: refresh (add/update from feeds, no delete)
    const result = await bootstrapProcurementIndex()
    return NextResponse.json({
      ok: true,
      mode: 'refresh',
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
      { error: 'Index bootstrap failed', detail: message, mode },
      { status: 500 }
    )
  }
}
