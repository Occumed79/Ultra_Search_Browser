// ─── DOMAIN MEMORY (Personalized Results) ───
// Allows users to raise, lower, pin, or block domains

import pg from 'pg'

const { Pool } = pg

export type DomainAction = 'raise' | 'lower' | 'pin' | 'block'

export interface DomainPreference {
  userId: string
  domain: string
  action: DomainAction
  createdAt: Date
  updatedAt: Date
}

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for domain memory')
    }
    pool = new Pool({ connectionString: databaseUrl })
  }
  return pool
}

/**
 * Initialize domain memory table
 */
export async function initializeDomainMemory(): Promise<void> {
  const client = getPool()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS domain_preferences (
        user_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('raise', 'lower', 'pin', 'block')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, domain)
      )
    `)

    // Create index for fast lookups by user
    await client.query(`
      CREATE INDEX IF NOT EXISTS domain_preferences_user_idx 
      ON domain_preferences (user_id)
    `)

    // Create index for fast lookups by domain
    await client.query(`
      CREATE INDEX IF NOT EXISTS domain_preferences_domain_idx 
      ON domain_preferences (domain)
    `)

    console.log('Domain memory table initialized')
  } catch (error) {
    console.error('Failed to initialize domain memory:', error)
    throw error
  }
}

/**
 * Set a domain preference for a user
 */
export async function setDomainPreference(
  userId: string,
  domain: string,
  action: DomainAction
): Promise<void> {
  const client = getPool()
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '')
  
  try {
    await client.query(
      `
      INSERT INTO domain_preferences (user_id, domain, action, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, domain) 
      DO UPDATE SET action = EXCLUDED.action, updated_at = NOW()
      `,
      [userId, normalizedDomain, action]
    )
  } catch (error) {
    console.error('Failed to set domain preference:', error)
    throw error
  }
}

/**
 * Remove a domain preference for a user
 */
export async function removeDomainPreference(
  userId: string,
  domain: string
): Promise<void> {
  const client = getPool()
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '')
  
  try {
    await client.query(
      'DELETE FROM domain_preferences WHERE user_id = $1 AND domain = $2',
      [userId, normalizedDomain]
    )
  } catch (error) {
    console.error('Failed to remove domain preference:', error)
    throw error
  }
}

/**
 * Get all domain preferences for a user
 */
export async function getDomainPreferences(
  userId: string
): Promise<DomainPreference[]> {
  const client = getPool()
  
  try {
    const result = await client.query(
      'SELECT user_id, domain, action, created_at, updated_at FROM domain_preferences WHERE user_id = $1',
      [userId]
    )
    return result.rows
  } catch (error) {
    console.error('Failed to get domain preferences:', error)
    throw error
  }
}

/**
 * Get preference for a specific domain
 */
export async function getDomainPreference(
  userId: string,
  domain: string
): Promise<DomainAction | null> {
  const client = getPool()
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '')
  
  try {
    const result = await client.query(
      'SELECT action FROM domain_preferences WHERE user_id = $1 AND domain = $2',
      [userId, normalizedDomain]
    )
    if (result.rows.length > 0) {
      return result.rows[0].action as DomainAction
    }
    return null
  } catch (error) {
    console.error('Failed to get domain preference:', error)
    throw error
  }
}

/**
 * Get all domains with a specific action for a user
 */
export async function getDomainsByAction(
  userId: string,
  action: DomainAction
): Promise<string[]> {
  const client = getPool()
  
  try {
    const result = await client.query(
      'SELECT domain FROM domain_preferences WHERE user_id = $1 AND action = $2',
      [userId, action]
    )
    return result.rows.map(row => row.domain)
  } catch (error) {
    console.error('Failed to get domains by action:', error)
    throw error
  }
}

/**
 * Apply domain preferences to search results
 * Returns adjusted scores and filtered results
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
    preferences
      .filter(p => p.action === 'block')
      .map(p => p.domain)
  )
  const pinnedDomains = new Set(
    preferences
      .filter(p => p.action === 'pin')
      .map(p => p.domain)
  )
  const raisedDomains = new Set(
    preferences
      .filter(p => p.action === 'raise')
      .map(p => p.domain)
  )
  const loweredDomains = new Set(
    preferences
      .filter(p => p.action === 'lower')
      .map(p => p.domain)
  )

  // Filter out blocked domains and adjust scores
  const filteredResults = results.filter(result => {
    try {
      const hostname = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '')
      
      if (blockedDomains.has(hostname)) {
        adjustments.set(result.url, {
          originalScore: result.score ?? 0,
          adjustedScore: 0,
          action: 'block',
        })
        return false // Blocked domains are filtered out
      }
      return true
    } catch {
      return true // Invalid URLs pass through
    }
  })

  // Adjust scores for remaining results
  filteredResults.forEach(result => {
    try {
      const hostname = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '')
      const originalScore = result.score ?? (1 / (result.rank ?? 1))
      let adjustedScore = originalScore
      let action: DomainAction | undefined

      if (pinnedDomains.has(hostname)) {
        // Pinned domains get maximum boost
        adjustedScore = originalScore * 10
        action = 'pin'
      } else if (raisedDomains.has(hostname)) {
        // Raised domains get moderate boost
        adjustedScore = originalScore * 2
        action = 'raise'
      } else if (loweredDomains.has(hostname)) {
        // Lowered domains get penalty
        adjustedScore = originalScore * 0.5
        action = 'lower'
      }

      if (action) {
        adjustments.set(result.url, {
          originalScore,
          adjustedScore,
          action,
        })
      }
    } catch {
      // Invalid URLs keep original score
    }
  })

  // Re-sort by adjusted scores
  filteredResults.sort((a, b) => {
    const aAdjustment = adjustments.get(a.url)
    const bAdjustment = adjustments.get(b.url)
    const aScore = aAdjustment?.adjustedScore ?? (a.score ?? 0)
    const bScore = bAdjustment?.adjustedScore ?? (b.score ?? 0)
    return bScore - aScore
  })

  // Update ranks after reordering
  filteredResults.forEach((result, index) => {
    result.rank = index + 1
  })

  return { results: filteredResults, adjustments }
}
