import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CURRENT_DATABASE_SCHEMA_VERSION, databaseSchemaState } from '../src/lib/database-schema-lifecycle'

const root = fileURLToPath(new URL('..', import.meta.url))
const lifecycleSource = readFileSync(`${root}/src/lib/database-schema-lifecycle.ts`, 'utf8')
const instrumentationSource = readFileSync(`${root}/src/instrumentation.ts`, 'utf8')
const healthSource = readFileSync(`${root}/src/app/api/health/route.ts`, 'utf8')

test('database schema lifecycle is versioned, verifies required tables, and detects newer incompatible schema', () => {
  assert.equal(CURRENT_DATABASE_SCHEMA_VERSION, 1)
  assert.match(lifecycleSource, /ultra_search_schema_versions/)
  assert.match(lifecycleSource, /currentVersion > CURRENT_DATABASE_SCHEMA_VERSION/)
  assert.match(lifecycleSource, /to_regclass/)
  for (const table of ['search_runs', 'search_results', 'pricing_findings', 'result_feedback', 'domain_preferences', 'bookmarks']) {
    assert.match(lifecycleSource, new RegExp(table))
  }
})

test('optional schema verification remains fail-open and collapsed across concurrent startup checks', () => {
  assert.match(lifecycleSource, /if \(!hasDatabase\(\)\)/)
  assert.match(lifecycleSource, /if \(target\.inFlight\) return target\.inFlight/)
  assert.match(lifecycleSource, /status: 'error'/)
  assert.match(instrumentationSource, /Optional database schema is not ready; core search remains available/)
  assert.match(instrumentationSource, /ensureDatabaseSchema/)
})

test('health diagnostics expose current versus expected persistence schema state', () => {
  assert.match(healthSource, /databaseSchema: schema/)
  assert.match(healthSource, /databaseSchemaReady/)
  const state = databaseSchemaState()
  assert.equal(state.expectedVersion, CURRENT_DATABASE_SCHEMA_VERSION)
  assert.ok(['disabled', 'unchecked', 'ready', 'behind', 'ahead', 'error'].includes(state.status))
})
