import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const canary = readFileSync(new URL('./production-user-flow-smoke.mjs', import.meta.url), 'utf8')
const workflow = readFileSync(new URL('../.github/workflows/production-smoke.yml', import.meta.url), 'utf8')

test('production canary exercises the exact broad query that exposed provider leakage', () => {
  assert.match(canary, /const QUERY = 'occupational health services'/)
  assert.match(canary, /\/api\/search\/plan/)
  assert.match(canary, /\/api\/search'/)
  assert.match(canary, /\/api\/search\/ingest/)
})

test('live canary rejects retained pages without procurement evidence or destination structure', () => {
  assert.match(canary, /PROCUREMENT_EVIDENCE/)
  assert.match(canary, /PROCUREMENT_DESTINATION/)
  assert.match(canary, /Non-procurement page survived the live ingest gate/)
})

test('live canary preserves zero-key and transport contracts', () => {
  assert.match(canary, /apiKeysRequired !== false/)
  assert.match(canary, /VALID_RETRIEVAL_TRANSPORTS/)
  assert.match(canary, /data\.diagnostics\?\.transport !== retrieval\.transport/)
})

test('production workflow runs fixture smoke and live user-flow smoke before publishing success', () => {
  assert.match(workflow, /node scripts\/production-smoke\.mjs/)
  assert.match(workflow, /node scripts\/production-user-flow-smoke\.mjs/)
  assert.match(workflow, /live zero-key search checks passed/)
})
