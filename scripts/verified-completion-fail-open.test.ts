import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/app/api/search/validate/route.ts', import.meta.url), 'utf8')

test('verified feedback learning is bounded and skipped for synthetic production validation', () => {
  assert.match(source, /VERIFIED_FEEDBACK_BUDGET_MS\s*=\s*2_000/)
  assert.match(source, /if \(!testMode && outcome\.results\.length > 0\)/)
  assert.match(source, /Verified feedback reranking failed or timed out/)
})

test('verified persistence has a hard response budget and fails open', () => {
  assert.match(source, /VERIFIED_PERSISTENCE_BUDGET_MS\s*=\s*3_500/)
  assert.match(source, /Verified persistence failed or timed out; completing evidence response/)
  assert.match(source, /persistenceTimedOut/)
  assert.match(source, /persistence-budget-exceeded/)
})

test('verified insert diagnostics count fulfilled null writes as failures', () => {
  assert.match(source, /const persistedCount = persisted\.filter\(item => item\.status === 'fulfilled' && item\.value\)\.length/)
  assert.match(source, /failed:\s*selected\.length - persistedCount/)
})

test('complete event remains the evidence decision output even if optional persistence fails', () => {
  assert.match(source, /write\('complete'/)
  assert.match(source, /verifiedOnly:\s*true/)
  assert.match(source, /pursuitLearningApplied/)
  assert.match(source, /verifiedPersistence:\s*persistence\.verifiedPersistence/)
})
