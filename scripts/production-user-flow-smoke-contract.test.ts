import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const canary = readFileSync(new URL('./production-user-flow-smoke.mjs', import.meta.url), 'utf8')
const smoke = readFileSync(new URL('./production-smoke.mjs', import.meta.url), 'utf8')
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

test('live canary recognizes established procurement listing portals and acquisition-stage language', () => {
  assert.match(canary, /sam\\\.gov/)
  assert.match(canary, /governmentcontracts\\\.us/)
  assert.match(canary, /contract-opportunit/)
  assert.match(canary, /opportunity-details/)
  assert.match(canary, /market research/)
  assert.match(canary, /acquisition strategy/)
  assert.match(canary, /strategic sourcing/)
})

test('live canary preserves optional-key and complete transport contracts', () => {
  assert.match(canary, /apiKeysRequired !== false/)
  assert.match(canary, /VALID_RETRIEVAL_TRANSPORTS/)
  for (const transport of [
    'searxng',
    'keenable',
    'multi-source',
    'zero-key-direct-rescue',
    'searxng+direct-rescue',
    'searxng+keenable',
    'keenable+direct-rescue',
    'searxng+keenable+direct-rescue',
    'multi-source+direct-rescue',
  ]) {
    assert.match(canary, new RegExp(transport.replace(/[+]/g, '\\+')))
    assert.match(smoke, new RegExp(transport.replace(/[+]/g, '\\+')))
  }
  assert.match(canary, /data\.diagnostics\?\.transport !== retrieval\.transport/)
  assert.match(smoke, /rfp-finder-v7-multisource/)
  assert.match(smoke, /SearXNG primary ensemble is missing/)
})

test('production canary fails when configured primary discovery contributes zero candidates', () => {
  for (const source of ['searxng', 'keenable', 'tinyfish', 'tavily', 'exa', 'langsearch']) {
    assert.match(canary, new RegExp(source, 'i'))
  }
  assert.match(canary, /recordPrimarySourceContribution\(data\)/)
  assert.match(canary, /configuredPrimarySources\.size > 0 && primaryCandidateTotal === 0/)
  assert.match(canary, /Direct rescue cannot mask a dead primary search stack/)
  assert.match(canary, /\[source-primary-summary\]/)
})

test('production workflow runs fixture smoke and live user-flow smoke before publishing success', () => {
  assert.match(workflow, /node scripts\/production-smoke\.mjs/)
  assert.match(workflow, /node scripts\/production-user-flow-smoke\.mjs/)
  assert.match(workflow, /live multi-source search checks passed/)
})
