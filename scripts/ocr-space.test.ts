import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resetProviderKeyPoolForTests } from '../src/lib/provider-key-pool'
import {
  OCR_SPACE_DAILY_LIMIT,
  OCR_SPACE_FREE_MAX_BYTES,
  ocrSpaceCapabilities,
  recognizePublicSolicitationPdf,
  type OcrSpaceUsageLedger,
} from '../src/lib/ocr-space'

const pdf = Buffer.from('%PDF-1.4\npublic test fixture')
const keys = {
  ENABLE_OCR_SPACE: 'true',
  OCR_API_KEY: 'separate-test-account-a',
  OCR_API_KEY_2: 'separate-test-account-b',
  OCR_API_KEY_3: 'separate-test-account-c',
}

function newLedger(): OcrSpaceUsageLedger & { attempts: Map<string, number>; blocked: Set<string>; successes: number } {
  const attempts = new Map<string, number>()
  const blocked = new Set<string>()
  let successes = 0
  return {
    attempts, blocked,
    get successes() { return successes },
    async reserve(day, fp, max) {
      const id = day + ':' + fp
      const count = attempts.get(id) || 0
      if (blocked.has(id) || count >= max) return false
      attempts.set(id, count + 1)
      return true
    },
    async recordSuccess() { successes++ },
    async block(day, fp) { blocked.add(day + ':' + fp) },
  }
}

function successResponse() {
  return new Response(JSON.stringify({
    IsErroredOnProcessing: false,
    OCRExitCode: 1,
    ParsedResults: [{ ParsedText: 'Open solicitation for occupational medical examinations and audiometry.' }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('OCR.space recognizes all three separately configured keys and never returns their values in capabilities', () => {
  const details = ocrSpaceCapabilities(keys)
  assert.equal(details.keyCount, 3)
  assert.equal(details.enabled, true)
  assert.equal(details.dailyLimitPerKey, 500)
  assert.equal(details.dailyReset, 'UTC')
  assert.equal(details.ledger, 'Neon PostgreSQL')
  assert.doesNotMatch(JSON.stringify(details), /separate-test-account/)
  assert.equal(ocrSpaceCapabilities({ OCR_API_KEY: 'key' }).enabled, false)
})

test('external OCR is never submitted for disabled, non-PDF, over-size, or over-three-page inputs', async () => {
  let calls = 0
  const ledger = newLedger()
  const fetchImpl = (async () => { calls++; return successResponse() }) as typeof fetch
  const base = { environment: keys, fetchImpl, ledger }
  assert.equal((await recognizePublicSolicitationPdf(pdf, { ...base, pageCount: 4 })).attempts, 0)
  assert.equal((await recognizePublicSolicitationPdf(Buffer.alloc(OCR_SPACE_FREE_MAX_BYTES + 1), { ...base, pageCount: 1 })).attempts, 0)
  assert.equal((await recognizePublicSolicitationPdf(Buffer.from('not a pdf'), { ...base, pageCount: 1 })).attempts, 0)
  assert.equal((await recognizePublicSolicitationPdf(pdf, { ...base, environment: {}, pageCount: 1 })).attempts, 0)
  assert.equal(calls, 0)
})

test('429 on account one blocks its daily budget and fails over to account two without disclosing credentials', async () => {
  resetProviderKeyPoolForTests()
  const ledger = newLedger()
  const seen: string[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.ocr.space/parse/image')
    assert.equal(init?.method, 'POST')
    assert.ok(init?.body instanceof FormData)
    const headers = init?.headers as Record<string, string>
    seen.push(headers.apikey)
    return headers.apikey === keys.OCR_API_KEY
      ? new Response('rate limited', { status: 429 })
      : successResponse()
  }) as typeof fetch
  const result = await recognizePublicSolicitationPdf(pdf, {
    environment: keys, fetchImpl, ledger, pageCount: 2,
    now: new Date('2026-10-20T04:00:00Z'),
  })
  assert.equal(result.success, true)
  assert.equal(result.keySlot, 'OCR_API_KEY_2')
  assert.equal(result.attempts, 2)
  assert.deepEqual(seen, [keys.OCR_API_KEY, keys.OCR_API_KEY_2])
  assert.equal(ledger.blocked.size, 1)
  assert.equal(ledger.successes, 1)
  assert.doesNotMatch(JSON.stringify(result), /separate-test-account/)
})

test('a second request rotates its starting account and continues safely', async () => {
  resetProviderKeyPoolForTests()
  const ledger = newLedger()
  const seen: string[] = []
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>).apikey)
    return successResponse()
  }) as typeof fetch
  const args = { environment: keys, fetchImpl, ledger, pageCount: 2 }
  assert.equal((await recognizePublicSolicitationPdf(pdf, args)).keySlot, 'OCR_API_KEY')
  assert.equal((await recognizePublicSolicitationPdf(pdf, args)).keySlot, 'OCR_API_KEY_2')
  assert.equal((await recognizePublicSolicitationPdf(pdf, args)).keySlot, 'OCR_API_KEY_3')
  assert.deepEqual(seen, [keys.OCR_API_KEY, keys.OCR_API_KEY_2, keys.OCR_API_KEY_3])
})

test('successful OCR stops when every per-key quota reservation is denied', async () => {
  resetProviderKeyPoolForTests()
  let calls = 0
  const ledger = newLedger()
  ledger.reserve = async () => false
  const result = await recognizePublicSolicitationPdf(pdf, {
    environment: keys, pageCount: 1, ledger,
    fetchImpl: (async () => { calls++; return successResponse() }) as typeof fetch,
  })
  assert.equal(result.success, false)
  assert.equal(result.attempts, 0)
  assert.equal(calls, 0)
})

test('quota accounting is scoped to UTC day and uses hashed key fingerprints', async () => {
  resetProviderKeyPoolForTests()
  const ledger = newLedger()
  const fetchImpl = (async () => successResponse()) as typeof fetch
  const first = await recognizePublicSolicitationPdf(pdf, {
    environment: { ENABLE_OCR_SPACE: 'true', OCR_API_KEY: 'private-test-secret' },
    pageCount: 1, ledger, fetchImpl, now: new Date('2026-10-20T23:59:59Z'),
  })
  const second = await recognizePublicSolicitationPdf(pdf, {
    environment: { ENABLE_OCR_SPACE: 'true', OCR_API_KEY: 'private-test-secret' },
    pageCount: 1, ledger, fetchImpl, now: new Date('2026-10-21T00:00:01Z'),
  })
  assert.equal(first.success, true)
  assert.equal(second.success, true)
  assert.equal(ledger.attempts.size, 2)
  assert.ok(Array.from(ledger.attempts.keys()).every(item => !item.includes('private-test-secret')))
})

test('OCR.space is invoked only from the procurement page validator, not arbitrary file extraction calls', () => {
  const extraction = readFileSync(new URL('../src/lib/document-extraction.ts', import.meta.url), 'utf8')
  const validation = readFileSync(new URL('../src/lib/page-validation.ts', import.meta.url), 'utf8')
  assert.match(extraction, /options\.publicSolicitation === true/)
  assert.match(validation, /lens === 'procurement'/)
  assert.match(validation, /ocrTimeoutMs: 8_500, ocrMaxPages: 2, publicSolicitation/)
  assert.match(validation, /fetchWithSafeRedirects/)
})
