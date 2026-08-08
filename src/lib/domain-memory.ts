// ─── DOMAIN MEMORY (Personalized Results) ───
// Allows users to raise, lower, pin, or block domains.

import { hasDatabase, query } from './db'

export type DomainAction = 'raise' | 'lower' | 'pin' | 'block'

export interface DomainPreference {
  userId: string
  domain: string
  action: DomainAction
  createdAt: Date
  updatedAt: Date
}

interface DomainPreferenceRow {
  user_id: string
  domain: string
  action: DomainAction
  created_at: Date
  updated_at: Date
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '')
}

function normalizePreferenceRow(row: DomainPreferenceRow): DomainPreference {
  return {
    userId: row.user_id,
    domain: row.domain,
    action: row.action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function requireWrite(result: Awaited<ReturnType<typeof query>>, operation: string): void {
  if (!result || result.rowCount === 0) {
    throw new Error(`${operation} was not acknowledged by the database`)
  }
}

/** Initialize domain memory table when PostgreSQL is configured. */
export async function initializeDomainMemory(): Promise<void> {
  if (!hasDatabase()) return

  const table = await query(`
    CREATE TABLE IF NOT EXISTS domain_preferences (
      user_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('raise', 'lower', 'pin', 'block')),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, domain)
    )
  `)
  if (!table) throw new Error('Domain memory table initialization failed')

  const userIndex = await query(`
    CREATE INDEX IF NOT EXISTS domain_preferences_user_idx
    ON domain_preferences (user_id)
  `)
  const domainIndex = await query(`
    CREATE INDEX IF NOT EXISTS domain_preferences_domain_idx
    ON domain_preferences (domain)
  `)
  if (!userIndex || !domainIndex) throw new Error('Domain memory index initialization failed')
}

/** Set a domain preference for a user. Writes are truthful: failure throws. */
export async function setDomainPreference(
  userId: string,
  domain: string,
  action: DomainAction
): Promise<void> {
  if (!hasDatabase()) throw new Error('DATABASE_URL is required for domain memory writes')
  const result = await query(
    `
    INSERT INTO domain_preferences (user_id, domain, action, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, domain)
    DO UPDATE SET action = EXCLUDED.action, updated_at = NOW()
    `,
    [userId, normalizeDomain(domain), action]
  )
  requireWrite(result, 'Domain preference write')
}

/** Remove a domain preference for a user. */
export async function removeDomainPreference(
  userId: string,
  domain: string
): Promise<void> {
  if (!hasDatabase()) throw new Error('DATABASE_URL is required for domain memory writes')
  const result = await query(
    'DELETE FROM domain_preferences WHERE user_id = $1 AND domain = $2',
    [userId, normalizeDomain(domain)]
  )
  if (!result) throw new Error('Domain preference delete failed')
}

/**
 * Get all domain preferences for a user. Reads fail open because domain memory
 * is optional personalization and must never break result rendering.
 */
export async function getDomainPreferences(userId: string): Promise<DomainPreference[]> {
  if (!hasDatabase()) return []
  const result = await query(
    'SELECT user_id, domain, action, created_at, updated_at FROM domain_preferences WHERE user_id = $1',
    [userId]
  )
  if (!result) return []
  return (result.rows as DomainPreferenceRow[]).map(normalizePreferenceRow)
}

/** Get preference for a specific domain. Optional reads fail open to null. */
export async function getDomainPreference(
  userId: string,
  domain: string
): Promise<DomainAction | null> {
  if (!hasDatabase()) return null
  const result = await query(
    'SELECT action FROM domain_preferences WHERE user_id = $1 AND domain = $2',
    [userId, normalizeDomain(domain)]
  )
  if (!result || result.rows.length === 0) return null
  return result.rows[0].action as DomainAction
}

/** Get all domains with a specific action for a user. */
export async function getDomainsByAction(
  userId: string,
  action: DomainAction
): Promise<string[]> {
  if (!hasDatabase()) return []
  const result = await query(
    'SELECT domain FROM domain_preferences WHERE user_id = $1 AND action = $2',
    [userId, action]
  )
  if (!result) return []
  return result.rows.map(row => String(row.domain))
}

/**
 * Apply domain preferences to search results.
 * Returns adjusted scores and filtered results.
 */
export interface AdjustedResult {
  originalScore: number
  adjustedScore: number
  action?: DomainAction
}

export function applyDomainPreferences(
  results: Array<{ url: string; score?: number; rank?: number }>,
  preferences: DomainPreference[]
): { results: typeof results; adjustments: Map<string, AdjustedResult> } {
  const adjustments = new Map<string, AdjustedResult>()
  const blockedDomains = new Set(
    preferences.filter(preference => preference.action === 'block').map(preference => preference.domain)
  )
  const pinnedDomains = new Set(
    preferences.filter(preference => preference.action === 'pin').map(preference => preference.domain)
  )
  const raisedDomains = new Set(
    preferences.filter(preference => preference.action === 'raise').map(preference => preference.domain)
  )
  const loweredDomains = new Set(
    preferences.filter(preference => preference.action === 'lower').map(preference => preference.domain)
  )

  const filteredResults = results.filter(result => {
    try {
      const hostname = normalizeDomain(new URL(result.url).hostname)
      if (blockedDomains.has(hostname)) {
        adjustments.set(result.url, {
          originalScore: result.score ?? 0,
          adjustedScore: 0,
          action: 'block',
        })
        return false
      }
      return true
    } catch {
      return true
    }
  })

  filteredResults.forEach(result => {
    try {
      const hostname = normalizeDomain(new URL(result.url).hostname)
      const originalScore = result.score ?? (1 / (result.rank ?? 1))
      let adjustedScore = originalScore
      let action: DomainAction | undefined

      if (pinnedDomains.has(hostname)) {
        adjustedScore = originalScore * 10
        action = 'pin'
      } else if (raisedDomains.has(hostname)) {
        adjustedScore = originalScore * 2
        action = 'raise'
      } else if (loweredDomains.has(hostname)) {
        adjustedScore = originalScore * 0.5
        action = 'lower'
      }

      if (action) {
        adjustments.set(result.url, { originalScore, adjustedScore, action })
      }
    } catch {
      // Invalid URLs keep their original score.
    }
  })

  filteredResults.sort((left, right) => {
    const leftScore = adjustments.get(left.url)?.adjustedScore ?? (left.score ?? 0)
    const rightScore = adjustments.get(right.url)?.adjustedScore ?? (right.score ?? 0)
    return rightScore - leftScore
  })

  filteredResults.forEach((result, index) => {
    result.rank = index + 1
  })

  return { results: filteredResults, adjustments }
}
