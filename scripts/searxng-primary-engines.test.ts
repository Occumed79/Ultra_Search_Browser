import test from 'node:test'
import assert from 'node:assert/strict'
import { SEARXNG_WEB_ENGINES } from '../src/lib/searxng-engines'
import { configuredSearxngEngines } from '../src/lib/searxng'

test('primary SearXNG ensemble includes normal Google, Google CSE, Bing, and DuckDuckGo', () => {
  const engines = configuredSearxngEngines()
  for (const engine of ['google', 'google cse', 'bing', 'duckduckgo']) {
    assert.ok(engines.includes(engine), `primary SearXNG ensemble is missing ${engine}`)
  }
  assert.deepEqual(engines, [...SEARXNG_WEB_ENGINES])
})
