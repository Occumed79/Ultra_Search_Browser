import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const smartFilter = readFileSync(new URL('../src/lib/occumed-smart-filter.ts', import.meta.url), 'utf8')
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')

test('Occu-Med procurement external reviewers require explicit feature opt-in', () => {
  assert.match(smartFilter, /ENABLE_EXTERNAL_SMART_FILTER === 'true'/)
  assert.match(smartFilter, /options\.useExternalProviders === true\s*&&\s*externalSemanticReviewEnabled\(\)/)
})

test('trial provider keys alone are documented as non-core and off by default', () => {
  assert.match(envExample, /ENABLE_EXTERNAL_SMART_FILTER=false/)
  assert.match(envExample, /Merely setting trial provider keys does not put them on the procurement critical/i)
  assert.match(envExample, /core zero-key SearXNG \+ public-engine retrieval path/i)
})

test('deep validation documentation reflects the current 48-candidate adaptive ceiling', () => {
  assert.match(envExample, /Up to 48 candidates may be/)
})
