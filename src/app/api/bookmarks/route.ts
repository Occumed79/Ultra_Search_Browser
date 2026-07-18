import { NextRequest, NextResponse } from 'next/server'
import { initializeSchema, insertBookmark } from '../../../lib/search-storage'
import { query } from '../../../lib/db'

export async function GET() {
  try {
    await initializeSchema()
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(
      'SELECT id, title, url, description, created_at FROM bookmarks ORDER BY created_at DESC LIMIT 500'
    )
    return NextResponse.json({ bookmarks: res?.rows ?? [] })
  } catch (error) {
    console.error('Failed to fetch bookmarks:', error)
    return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeSchema()
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const body = (await request.json()) as {
      title?: string
      url?: string
      description?: string
    }
    const url = body.url?.trim()
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    const bookmark = {
      id: crypto.randomUUID(),
      user_id: 'default',
      url,
      title: body.title?.trim() || url,
      description: body.description?.trim() || undefined,
    }
    const id = await insertBookmark(bookmark)

    return NextResponse.json({
      bookmark: {
        id,
        title: bookmark.title,
        url: bookmark.url,
        description: bookmark.description,
        created_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to create bookmark:', error)
    return NextResponse.json({ error: 'Failed to create bookmark' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeSchema()
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const id = request.nextUrl.searchParams.get('id')
    const url = request.nextUrl.searchParams.get('url')
    if (!id && !url) {
      return NextResponse.json({ error: 'id or url required' }, { status: 400 })
    }

    if (id) {
      await query('DELETE FROM bookmarks WHERE id = $1', [id])
    } else {
      await query('DELETE FROM bookmarks WHERE url = $1', [url])
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete bookmark:', error)
    return NextResponse.json({ error: 'Failed to delete bookmark' }, { status: 500 })
  }
}
