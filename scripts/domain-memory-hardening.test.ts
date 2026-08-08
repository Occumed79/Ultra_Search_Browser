import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const memory = readFileSync(new URL('../src/lib/domain-memory.ts', import.meta.url), 'utf8')
const route = readFileSync(new URL('../src/app/api/domain-preferences/route.ts', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

test('domain memory uses the shared bounded database layer instead of a second pg Pool', () => {
  assert.match(memory, /import \{ hasDatabase, query \} from '\.\/db'/)
  assert.doesNotMatch(memory, /new Pool\(/)
  assert.doesNotMatch(memory, /import pg from 'pg'/)
})

test('optional domain-memory reads fail open when PostgreSQL is unavailable', () => {
  assert.match(memory, /if \(!hasDatabase\(\)\) return \[\]/)
  assert.match(memory, /if \(!hasDatabase\(\)\) return null/)
})

test('domain preference writes require an acknowledged shared-database write', () => {
  assert.match(memory, /requireWrite\(result, 'Domain preference write'\)/)
  assert.match(memory, /result\.rowCount === 0/)
})

test('concurrent result-card preference reads collapse into a short-lived server promise', () => {
  assert.match(route, /const PREFERENCE_CACHE_TTL_MS = 5_000/)
  assert.match(route, /const preferenceReads = new Map/)
  assert.match(route, /if \(cached && cached\.expiresAt > now\) return cached\.promise/)
  assert.match(route, /invalidatePreferenceCache\(userIdToUse\)/)
  assert.match(route, /invalidatePreferenceCache\(userId\)/)
})

test('README matches hardened zero-key rescue and explicit external reviewer opt-in', () => {
  assert.match(readme, /Google\/DuckDuckGo\/Bing rescue pass/)
  assert.match(readme, /ENABLE_EXTERNAL_SMART_FILTER=true/)
  assert.match(readme, /live `occupational health services` plan → retrieval → ingest canary/)
})
