// ─── DOMAIN PREFERENCES API ───
// API endpoints for domain memory (raise/lower/pin/block)

import { NextRequest, NextResponse } from 'next/server'
import {
  setDomainPreference,
  removeDomainPreference,
  getDomainPreferences,
  getDomainPreference,
} from '../../../lib/domain-memory'

// GET /api/domain-preferences - Get all domain preferences for a user
export async function GET(request: NextRequest) {
  try {
    // For now, use a simple user ID from query param or session
    // In production, this would come from authentication
    const userId = request.nextUrl.searchParams.get('userId') || 'default'
    
    const preferences = await getDomainPreferences(userId)
    return NextResponse.json({ preferences })
  } catch (error) {
    console.error('Failed to get domain preferences:', error)
    return NextResponse.json(
      { error: 'Failed to get domain preferences' },
      { status: 500 }
    )
  }
}

// POST /api/domain-preferences - Set a domain preference
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
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to set domain preference:', error)
    return NextResponse.json(
      { error: 'Failed to set domain preference' },
      { status: 500 }
    )
  }
}

// DELETE /api/domain-preferences - Remove a domain preference
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
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to remove domain preference:', error)
    return NextResponse.json(
      { error: 'Failed to remove domain preference' },
      { status: 500 }
    )
  }
}
