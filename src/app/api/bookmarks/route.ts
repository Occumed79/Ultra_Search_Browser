import { NextRequest, NextResponse } from 'next/server'
import { initializeSchema, insertBookmark } from '../../../lib/search-storage'
import { query } from '../../../lib/db'

const DEFAULT_USER_ID = 'default'

function normalizeBookmarkUrl(value: string) {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`

  try {
    const parsed = new URL(candidate)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    parsed.hash = ''

    const url = parsed.toString()
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url

    return {
      url,
      normalizedUrl,
      domain: parsed.hostname.replace(/^www\./i, '').toLowerCase(),
    }
  } catch {
    return null
  }
}

export async function GET() {
  try {
    await initializeSchema()
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'No database configured' }, { status: 501 })
    }

    const res = await query(
      `SELECT id, title, url, description, created_at
       FROM bookmarks
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [DEFAULT_USER_ID]
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
    const normalized = body.url?.trim() ? normalizeBookmarkUrl(body.url.trim()) : null
    if (!normalized) {
      return NextResponse.json({ error: 'A valid http(s) URL is required' }, { status: 400 })
    }

    const title = body.title?.trim() || normalized.domain || normalized.url
    const description = body.description?.trim() || null
    const existing = await query(
      `SELECT id
       FROM bookmarks
       WHERE user_id = $1 AND (normalized_url = $2 OR url = $3)
       ORDER BY created_at DESC
       LIMIT 1`,
      [DEFAULT_USER_ID, normalized.normalizedUrl, normalized.url]
    )
    const existingId = existing?.rows?.[0]?.id as string | undefined

    if (existingId) {
      await query(
        `UPDATE bookmarks
         SET title = $1,
             description = COALESCE($2, description),
             url = $3,
             normalized_url = $4,
             domain = $5,
             updated_at = NOW()
         WHERE id = $6 AND user_id = $7`,
        [title, description, normalized.url, normalized.normalizedUrl, normalized.domain, existingId, DEFAULT_USER_ID]
      )

      return NextResponse.json({
        bookmark: {
          id: existingId,
          title,
          url: normalized.url,
          description,
          created_at: new Date().toISOString(),
        },
        deduplicated: true,
      })
    }

    const id = await insertBookmark({
      user_id: DEFAULT_USER_ID,
      url: normalized.url,
      normalized_url: normalized.normalizedUrl,
      domain: normalized.domain,
      title,
      description: description ?? undefined,
    })

    return NextResponse.json({
      bookmark: {
        id,
        title,
        url: normalized.url,
        description,
        created_at: new Date().toISOString(),
      },
      deduplicated: false,
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

    const clearAll = request.nextUrl.searchParams.get('all') === 'true'
    const id = request.nextUrl.searchParams.get('id')
    const url = request.nextUrl.searchParams.get('url')

    if (clearAll) {
      await query('DELETE FROM bookmarks WHERE user_id = $1', [DEFAULT_USER_ID])
      return NextResponse.json({ success: true })
    }

    if (!id && !url) {
      return NextResponse.json({ error: 'id or url required' }, { status: 400 })
    }

    if (id) {
      await query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2', [id, DEFAULT_USER_ID])
    } else {
      const normalized = url ? normalizeBookmarkUrl(url) : null
      await query(
        'DELETE FROM bookmarks WHERE user_id = $1 AND (url = $2 OR normalized_url = $3)',
        [DEFAULT_USER_ID, normalized?.url ?? url, normalized?.normalizedUrl ?? url]
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete bookmark:', error)
    return NextResponse.json({ error: 'Failed to delete bookmark' }, { status: 500 })
  }
}
