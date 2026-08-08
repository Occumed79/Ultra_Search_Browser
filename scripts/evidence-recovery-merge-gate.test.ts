import test from 'node:test'
import assert from 'node:assert/strict'
import { extractEmbeddedClientState, isOCREnabled } from '../src/lib/document-extraction'
import { headlessRecoveryCapabilities } from '../src/lib/headless-page-recovery'

test('evidence recovery remains bounded and opt-in at the merge gate', () => {
  const embedded = extractEmbeddedClientState('<html><body><script type="application/json">{"solicitation":"RFP 26-100 occupational health services"}</script></body></html>')
  assert.match(embedded, /RFP 26-100/)
  const headless = headlessRecoveryCapabilities()
  assert.equal(headless.maxConcurrency, 1)
  assert.ok(headless.maxPerMinute <= 8)
  assert.ok(headless.timeoutMs <= 8_000)
  if (process.env.ENABLE_OCR !== 'true') assert.equal(isOCREnabled(), false)
})
