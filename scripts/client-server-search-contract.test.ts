import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSource = readFileSync(new URL('../src/hooks/use-search.ts', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../src/lib/browser-search-bridge.ts', import.meta.url), 'utf8')

test('homepage orchestration uses the server retrieval contract without extension-era requirements', () => {
  assert.match(hookSource, /runServerSearchPlan/)
  assert.doesNotMatch(hookSource, /browser companion/i)
  assert.doesNotMatch(hookSource, /browser-extension/i)
  assert.doesNotMatch(hookSource, /retrieval_mode:\s*['"]browser-fed['"]/i)
})

test('retrieval transport is preserved through ingest and local search history', () => {
  assert.match(hookSource, /transport:\s*serverBatch\.transport/)
  assert.match(hookSource, /retrieval_mode:\s*transport/)
  assert.match(hookSource, /retrieval_engines:\s*serverBatch\.engines/)
})

test('new searches cancel in-flight retrieval and validation work', () => {
  assert.match(hookSource, /searchController\.current\?\.abort/)
  assert.match(hookSource, /validationController\.current\?\.abort/)
  assert.match(hookSource, /signal:\s*controller\.signal/)
})

test('client validation progress uses the same 48-target ceiling as deep validation', () => {
  assert.match(hookSource, /MAX_VALIDATION_TARGETS\s*=\s*48/)
  assert.match(hookSource, /Math\.min\(MAX_VALIDATION_TARGETS, results\.length\)/)
})

test('server bridge supports timeout and external cancellation while keeping legacy wrappers isolated', () => {
  assert.match(bridgeSource, /export async function runServerSearchPlan/)
  assert.match(bridgeSource, /externalSignal\.addEventListener\('abort'/)
  assert.match(bridgeSource, /Search retrieval timed out after/)
  assert.match(bridgeSource, /@deprecated The app no longer requires a browser companion/)
})
