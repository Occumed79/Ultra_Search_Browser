import { NextRequest, NextResponse } from 'next/server'
import { query } from '../../../lib/db'

export async function GET(request: NextRequest) {
  try {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(`SELECT id, title, url, notes, created_at FROM bookmarks ORDER BY created_at DESC LIMIT 500`)
    return NextResponse.json({ bookmarks: res.rows || [] })
  } catch (err) {
    console.error('Failed to fetch bookmarks:', err)
    return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const databaseUrl = process.env.DATABASE_URL
    const body = await request.json()
    const { title, url, notes } = body
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

    if (!databaseUrl) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(`INSERT INTO bookmarks (id, title, url, notes, created_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id`, [title || null, url, notes || null])
    return NextResponse.json({ bookmark: res.rows[0] })
  } catch (err) {
    console.error('Failed to create bookmark:', err)
    return NextResponse.json({ error: 'Failed to create bookmark' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const id = request.nextUrl.searchParams.get('id')
    const url = request.nextUrl.searchParams.get('url')
    if (!id && !url) {
      return NextResponse.json({ error: 'id or url required' }, { status: 400 })
    }

    if (id) {
      await query(`DELETE FROM bookmarks WHERE id = $1`, [id])
    } else {
      await query(`DELETE FROM bookmarks WHERE url = $1`, [url])
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to delete bookmark:', err)
    return NextResponse.json({ error: 'Failed to delete bookmark' }, { status: 500 })
  }
}
