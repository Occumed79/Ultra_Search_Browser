import { NextRequest, NextResponse } from 'next/server'
import { insertResultFeedback } from '../../../lib/search-storage'
import { setDomainPreference } from '../../../lib/domain-memory'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { resultId, url, feedbackType, notes, userId } = body as { resultId?: string; url?: string; feedbackType: string; notes?: string; userId?: string }

    if (!feedbackType) {
      return NextResponse.json({ error: 'feedbackType is required' }, { status: 400 })
    }

    // Save feedback to DB if available (fail-open)
    try {
      await insertResultFeedback({ result_id: resultId, feedback_type: feedbackType, notes })
    } catch (err) {
      // fail-open: log and continue
      console.warn('insertResultFeedback failed:', err)
    }

    // If feedback indicates a domain-level preference, update domain_preferences
    const domainActions = new Set(['pin', 'raise', 'lower', 'block'])
    if (domainActions.has(feedbackType) && url) {
      try {
        const domain = (() => {
          try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
        })()
        const uid = userId || 'default'
        await setDomainPreference(uid, domain, feedbackType as any)
      } catch (err) {
        console.warn('setDomainPreference failed:', err)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Feedback API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
