import { NextRequest, NextResponse } from 'next/server'
import {
  setDomainPreference,
  removeDomainPreference,
  getDomainPreferences,
  type DomainPreference,
} from '../../../lib/domain-memory'

const PREFERENCE_CACHE_TTL_MS = 5_000
const preferenceReads = new Map<string, {
  expiresAt: number
  promise: Promise<DomainPreference[]>
}>()

function cachedPreferences(userId: string): Promise<DomainPreference[]> {
  const now = Date.now()
  const cached = preferenceReads.get(userId)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = getDomainPreferences(userId).catch(error => {
    preferenceReads.delete(userId)
    throw error
  })
  preferenceReads.set(userId, {
    expiresAt: now + PREFERENCE_CACHE_TTL_MS,
    promise,
  })
  return promise
}

function invalidatePreferenceCache(userId: string) {
  preferenceReads.delete(userId)
}

// GET /api/domain-preferences - Get all domain preferences for a user.
// Concurrent result cards share one short-lived read promise so a result page
// cannot multiply identical Neon queries by the number of visible cards.
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId') || 'default'
    const preferences = await cachedPreferences(userId)
    return NextResponse.json({ preferences }, {
      headers: { 'Cache-Control': 'private, max-age=5' },
    })
  } catch (error) {
    console.error('Failed to get domain preferences:', error)
    return NextResponse.json(
      { error: 'Failed to get domain preferences' },
      { status: 500 }
    )
  }
}

// POST /api/domain-preferences - Set a domain preference.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, domain, action } = body

    if (!domain || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: domain, action' },
        { status: 400 }
      )
    }

    const userIdToUse = userId || 'default'
    await setDomainPreference(userIdToUse, domain, action)
    invalidatePreferenceCache(userIdToUse)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to set domain preference:', error)
    return NextResponse.json(
      { error: 'Failed to set domain preference' },
      { status: 500 }
    )
  }
}

// DELETE /api/domain-preferences - Remove a domain preference.
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId') || 'default'
    const domain = request.nextUrl.searchParams.get('domain')

    if (!domain) {
      return NextResponse.json(
        { error: 'Missing required field: domain' },
        { status: 400 }
      )
    }

    await removeDomainPreference(userId, domain)
    invalidatePreferenceCache(userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to remove domain preference:', error)
    return NextResponse.json(
      { error: 'Failed to remove domain preference' },
      { status: 500 }
    )
  }
}
