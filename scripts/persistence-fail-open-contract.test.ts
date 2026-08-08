import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dbSource = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
const storageSource = readFileSync(new URL('../src/lib/search-storage.ts', import.meta.url), 'utf8')
const processingSource = readFileSync(new URL('../src/lib/search-candidate-processing.ts', import.meta.url), 'utf8')

test('database pool bounds connection, idle, query, and statement waits', () => {
  assert.match(dbSource, /connectionTimeoutMillis:\s*DATABASE_CONNECT_TIMEOUT_MS/)
  assert.match(dbSource, /idleTimeoutMillis:\s*DATABASE_IDLE_TIMEOUT_MS/)
  assert.match(dbSource, /query_timeout:\s*DATABASE_QUERY_TIMEOUT_MS/)
  assert.match(dbSource, /statement_timeout:\s*DATABASE_QUERY_TIMEOUT_MS/)
})

test('database client acquisition fails open and always releases acquired clients', () => {
  assert.match(dbSource, /client\s*=\s*await p\.connect\(\)/)
  assert.match(dbSource, /catch \(error\)/)
  assert.match(dbSource, /client\?\.release\(\)/)
})

test('storage helpers return ids only after an acknowledged insert', () => {
  assert.match(storageSource, /function insertedOne/)
  assert.match(storageSource, /result\.rowCount === 1/)
  assert.ok((storageSource.match(/return insertedOne\(inserted\) \? id : null/g) || []).length >= 5)
})

test('candidate persistence and feedback ranking are optional bounded enrichments', () => {
  assert.match(processingSource, /FEEDBACK_RANKING_BUDGET_MS\s*=\s*2_500/)
  assert.match(processingSource, /CANDIDATE_PERSISTENCE_BUDGET_MS\s*=\s*4_000/)
  assert.match(processingSource, /persistenceTimedOut/)
  assert.match(processingSource, /returning search results without blocking/)
})

test('null fulfilled insert results count as persistence failures instead of phantom success', () => {
  assert.match(processingSource, /if \(item\.status === 'fulfilled' && item\.value\.id\)/)
  assert.match(processingSource, /else \{\s*persistenceFailures \+= 1/s)
  assert.match(processingSource, /persisted:\s*shouldPersist && Boolean\(searchRunId\) && persistenceFailures === 0/)
})
