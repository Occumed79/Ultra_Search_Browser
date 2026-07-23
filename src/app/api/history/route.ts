import { NextRequest, NextResponse } from 'next/server'
import { query } from '../../../lib/db'

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(
      `SELECT id, vertical, query, normalized_query, lens, created_at, result_count, sources
       FROM search_runs
       ORDER BY created_at DESC
       LIMIT 200`
    )

    return NextResponse.json({ runs: res?.rows ?? [] })
  } catch (error) {
    console.error('Failed to fetch history:', error)
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    if (request.nextUrl.searchParams.get('all') !== 'true') {
      return NextResponse.json({ error: 'all=true is required' }, { status: 400 })
    }

    await query('DELETE FROM search_runs')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to clear history:', error)
    return NextResponse.json({ error: 'Failed to clear history' }, { status: 500 })
  }
}
