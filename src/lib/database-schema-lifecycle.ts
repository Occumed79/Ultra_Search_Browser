import { hasDatabase, query } from './db'
import { initializeSchema } from './search-storage'

export const CURRENT_DATABASE_SCHEMA_VERSION = 1
const SCHEMA_CHECK_TTL_MS = 5 * 60_000
const REQUIRED_CORE_TABLES = [
  'search_runs',
  'search_results',
  'pricing_findings',
  'result_feedback',
  'domain_preferences',
  'bookmarks',
] as const

export type DatabaseSchemaStatus = 'disabled' | 'unchecked' | 'ready' | 'behind' | 'ahead' | 'error'

export interface DatabaseSchemaState {
  status: DatabaseSchemaStatus
  expectedVersion: number
  currentVersion?: number
  checkedAt?: string
  error?: string
  missingTables?: string[]
}

const GLOBAL_KEY = '__ULTRA_SEARCH_SCHEMA_LIFECYCLE_V1__'
type GlobalWithSchemaState = typeof globalThis & {
  [GLOBAL_KEY]?: {
    state: DatabaseSchemaState
    checkedAtMs: number
    inFlight?: Promise<DatabaseSchemaState>
  }
}

function holder() {
  const globalObject = globalThis as GlobalWithSchemaState
  if (!globalObject[GLOBAL_KEY]) {
    globalObject[GLOBAL_KEY] = {
      state: {
        status: hasDatabase() ? 'unchecked' : 'disabled',
        expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      },
      checkedAtMs: 0,
    }
  }
  return globalObject[GLOBAL_KEY]!
}

function publish(state: DatabaseSchemaState): DatabaseSchemaState {
  const target = holder()
  target.state = state
  target.checkedAtMs = Date.now()
  return state
}

async function installedVersion(): Promise<number> {
  const result = await query(
    'SELECT COALESCE(MAX(version), 0)::int AS version FROM ultra_search_schema_versions'
  )
  return Number(result?.rows?.[0]?.version || 0)
}

async function verifyRequiredTables(): Promise<string[]> {
  const missing: string[] = []
  for (const table of REQUIRED_CORE_TABLES) {
    const result = await query('SELECT to_regclass($1) AS relation', [`public.${table}`])
    if (!result?.rows?.[0]?.relation) missing.push(table)
  }
  return missing
}

async function performSchemaCheck(): Promise<DatabaseSchemaState> {
  if (!hasDatabase()) {
    return publish({ status: 'disabled', expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION })
  }

  const checkedAt = new Date().toISOString()
  try {
    const migrationTable = await query(`
      CREATE TABLE IF NOT EXISTS ultra_search_schema_versions (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    if (!migrationTable) {
      return publish({
        status: 'error',
        expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
        checkedAt,
        error: 'Could not create or read the schema version table.',
      })
    }

    let currentVersion = await installedVersion()
    if (currentVersion > CURRENT_DATABASE_SCHEMA_VERSION) {
      return publish({
        status: 'ahead',
        expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
        currentVersion,
        checkedAt,
        error: `Database schema version ${currentVersion} is newer than runtime version ${CURRENT_DATABASE_SCHEMA_VERSION}.`,
      })
    }

    if (currentVersion < CURRENT_DATABASE_SCHEMA_VERSION) {
      publish({
        status: 'behind',
        expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
        currentVersion,
        checkedAt,
      })
      await initializeSchema()
      const missingTables = await verifyRequiredTables()
      if (missingTables.length > 0) {
        return publish({
          status: 'error',
          expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
          currentVersion,
          checkedAt,
          missingTables,
          error: `Core schema migration did not create required tables: ${missingTables.join(', ')}.`,
        })
      }
      const recorded = await query(
        `INSERT INTO ultra_search_schema_versions (version, description)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
        [CURRENT_DATABASE_SCHEMA_VERSION, 'Core Ultra Search persistence schema']
      )
      if (!recorded) {
        return publish({
          status: 'error',
          expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
          currentVersion,
          checkedAt,
          error: 'Core schema existed but the migration version could not be recorded.',
        })
      }
      currentVersion = CURRENT_DATABASE_SCHEMA_VERSION
    }

    const missingTables = await verifyRequiredTables()
    if (missingTables.length > 0) {
      return publish({
        status: 'error',
        expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
        currentVersion,
        checkedAt,
        missingTables,
        error: `Schema version is recorded but required tables are missing: ${missingTables.join(', ')}.`,
      })
    }

    return publish({
      status: 'ready',
      expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      currentVersion,
      checkedAt,
    })
  } catch (error) {
    return publish({
      status: 'error',
      expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Optional persistence must never become a core-search dependency. This helper
 * returns a state object instead of throwing and collapses concurrent schema
 * checks into one promise per server process.
 */
export async function ensureDatabaseSchema(force = false): Promise<DatabaseSchemaState> {
  const target = holder()
  if (!hasDatabase()) return publish({ status: 'disabled', expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION })
  if (!force && target.state.status === 'ready' && Date.now() - target.checkedAtMs < SCHEMA_CHECK_TTL_MS) {
    return target.state
  }
  if (target.inFlight) return target.inFlight

  target.inFlight = performSchemaCheck().finally(() => {
    holder().inFlight = undefined
  })
  return target.inFlight
}

export function databaseSchemaState(): DatabaseSchemaState {
  const target = holder()
  if (!hasDatabase()) return { status: 'disabled', expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION }
  return { ...target.state, missingTables: target.state.missingTables ? [...target.state.missingTables] : undefined }
}

export async function databaseSchemaReady(): Promise<boolean> {
  const state = await ensureDatabaseSchema()
  return state.status === 'ready'
}

/** Test-only reset; not exported from any HTTP mutation endpoint. */
export function resetDatabaseSchemaLifecycleForTests(): void {
  const target = holder()
  target.state = {
    status: hasDatabase() ? 'unchecked' : 'disabled',
    expectedVersion: CURRENT_DATABASE_SCHEMA_VERSION,
  }
  target.checkedAtMs = 0
  target.inFlight = undefined
}
