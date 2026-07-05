import { NextRequest, NextResponse } from 'next/server'
import { initializeSchema } from '../../../lib/search-storage'
import { insertBookmark } from '../../../lib/search-storage'
import { query } from '../../../lib/db'

export async function GET(request: NextRequest) {
  try {
    await initializeSchema()
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(`SELECT id, title, url, description, created_at FROM bookmarks ORDER BY created_at DESC LIMIT 500`)
    return NextResponse.json({ bookmarks: res.rows || [] })
  } catch (err) {
    console.error('Failed to fetch bookmarks:', err)
    return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeSchema()
    const databaseUrl = process.env.DATABASE_URL
    const body = await request.json()
    const { title, url, description } = body
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

    if (!databaseUrl) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const id = await insertBookmark({ id: crypto.randomUUID(), user_id: 'default', url, title: title || null, description: description || null })
    return NextResponse.json({ bookmark: { id } })
  } catch (err) {
    console.error('Failed to create bookmark:', err)
    return NextResponse.json({ error: 'Failed to create bookmark' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeSchema()
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
