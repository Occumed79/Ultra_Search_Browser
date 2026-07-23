import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchPath, parseSearchUrl } from '../src/lib/search-url'

test('parses a shareable query and lens from the URL', () => {
  assert.deepEqual(
    parseSearchUrl('?q=occupational%20health%20pricing&lens=pricing'),
    { query: 'occupational health pricing', lens: 'pricing' }
  )
})

test('falls back to the web lens for an invalid URL lens', () => {
  assert.deepEqual(
    parseSearchUrl('?q=respirator%20fit%20testing&lens=unknown'),
    { query: 'respirator fit testing', lens: 'web' }
  )
})

test('returns null when the URL does not contain a query', () => {
  assert.equal(parseSearchUrl('?lens=government'), null)
})

test('builds a reproducible search path while preserving unrelated parameters', () => {
  assert.equal(
    buildSearchPath('/', '?theme=dark', 'OSHA 1910.134 fit testing', 'government'),
    '/?theme=dark&q=OSHA+1910.134+fit+testing&lens=government'
  )
})

test('removes only search state when the query is cleared', () => {
  assert.equal(
    buildSearchPath('/results', '?q=old&lens=pdf&theme=dark', '', 'web', '#top'),
    '/results?theme=dark#top'
  )
})
