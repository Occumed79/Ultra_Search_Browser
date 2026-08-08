import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const canary = readFileSync(new URL('./production-user-flow-smoke.mjs', import.meta.url), 'utf8')
const workflow = readFileSync(new URL('../.github/workflows/production-smoke.yml', import.meta.url), 'utf8')

test('production canary exercises the broad query plus the major Occu-Med capability families', () => {
  assert.match(canary, /const CANARY_QUERIES = \[/)
  for (const query of [
    'occupational health services',
    'medical surveillance services',
    'audiometry hearing conservation services',
    'respirator medical clearance services',
    'employee medical examinations',
    'drug and alcohol testing services',
    'deployment medical readiness examinations',
    'fitness for duty occupational medicine services',
    'OCONUS occupational health services',
  ]) {
    assert.match(canary, new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  }
  const canaryArrayMatch = canary.match(/const CANARY_QUERIES = \[([\s\S]*?)\]/)
  assert.ok(canaryArrayMatch, 'could not parse production canary query matrix')
  const configuredQueries = [...canaryArrayMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1])
  assert.equal(configuredQueries.length, 9, `production canary matrix must stay at nine capability paths, saw ${configuredQueries.length}`)
  assert.match(canary, /for \(const query of CANARY_QUERIES\)/)
  assert.match(canary, /fetch\(`\$\{APP_URL\}\/api\/search\/plan`,/)
  assert.match(canary, /fetch\(`\$\{APP_URL\}\/api\/search`,/)
  assert.match(canary, /fetch\(`\$\{APP_URL\}\/api\/search\/ingest`,/)
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
