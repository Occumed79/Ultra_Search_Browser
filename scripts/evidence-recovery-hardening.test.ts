import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractEmbeddedClientState,
  extractFromHTML,
  extractScannedPdfWithOcr,
} from '../src/lib/document-extraction'
import { headlessRecoveryCapabilities } from '../src/lib/headless-page-recovery'
import { validateCandidatePage } from '../src/lib/page-validation'
import type { ScrapedResult } from '../src/types/search'

function candidate(url: string, title = 'Occupational Health Services RFP'): ScrapedResult {
  return {
    title,
    url,
    description: 'Request for proposals for occupational health services.',
    domain: new URL(url).hostname,
    source: 'test',
    rank: 1,
    score: 90,
  }
}

test('client-rendered procurement JSON state becomes readable evidence without executing page JavaScript', () => {
  const html = `<!doctype html><html><head><title>Bid Portal</title><meta name="description" content="Public procurement opportunity"></head><body><div id="app">Loading...</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        solicitation: {
          number: 'RFP-2026-44',
          title: 'Occupational Health and Medical Surveillance Services',
          scope: 'The contractor shall provide pre-employment medical examinations, medical surveillance, audiograms, spirometry, respirator medical clearance, laboratory testing, vaccinations, and physician medical review for employees across multiple locations.',
          status: 'Open',
          closingDate: 'October 15, 2026',
        },
      },
    },
  })}</script></body></html>`

  const embedded = extractEmbeddedClientState(html)
  assert.match(embedded, /RFP-2026-44/)
  assert.match(embedded, /medical surveillance/i)
  assert.match(embedded, /October 15, 2026/)

  const document = extractFromHTML(html, 'https://buyer.example.gov/procurement/rfp-2026-44')
  assert.ok(document.text.length > 180)
  assert.match(document.text, /respirator medical clearance/i)
  assert.equal(document.metadata.fileType, 'html-client-state')
})

test('page validation can promote a thin shell to substantive evidence from embedded application state', async () => {
  const previousHeadless = process.env.ENABLE_HEADLESS_VALIDATION
  process.env.ENABLE_HEADLESS_VALIDATION = 'false'
  try {
    const html = `<html><head><title>Procurement Portal</title></head><body><div>Loading...</div><script type="application/json">${JSON.stringify({
      solicitation: 'Request for Proposals RFP-2026-77',
      scope: 'Occupational health services including employee medical examinations, medical surveillance, audiometry, spirometry, drug testing, respirator clearance, and provider network coordination.',
      notice: 'The solicitation is open and proposals are due October 30, 2026. Vendors may submit responses through the procurement portal.',
    })}</script></body></html>`
    const result = await validateCandidatePage(
      candidate('https://buyer.example.gov/procurement/rfp-2026-77'),
      'procurement',
      'occupational health services',
      {
        bypassCache: true,
        inspectPackage: false,
        fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
      }
    )
    assert.equal(result.availability, 'reachable')
    assert.ok(result.extractedTextLength > 180)
    assert.match(result.extractedText, /employee medical examinations/i)
  } finally {
    if (previousHeadless === undefined) delete process.env.ENABLE_HEADLESS_VALIDATION
    else process.env.ENABLE_HEADLESS_VALIDATION = previousHeadless
  }
})

test('unreadable procurement shells remain REVIEW-class evidence instead of becoming lifecycle junk', async () => {
  const previousHeadless = process.env.ENABLE_HEADLESS_VALIDATION
  process.env.ENABLE_HEADLESS_VALIDATION = 'false'
  try {
    const result = await validateCandidatePage(
      candidate('https://buyer.example.gov/procurement/rfp-thin'),
      'procurement',
      'occupational health services',
      {
        bypassCache: true,
        inspectPackage: false,
        fetchImpl: async () => new Response('<html><body><div id="app">Loading...</div></body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      }
    )
    assert.equal(result.availability, 'unsupported')
    assert.equal(result.lifecycle.status, 'unknown')
    assert.match(result.reason, /manual review/i)
  } finally {
    if (previousHeadless === undefined) delete process.env.ENABLE_HEADLESS_VALIDATION
    else process.env.ENABLE_HEADLESS_VALIDATION = previousHeadless
  }
})

test('scanned PDF OCR is explicit, bounded, and fail-open when OCR is disabled', async () => {
  const previous = process.env.ENABLE_OCR
  process.env.ENABLE_OCR = 'false'
  try {
    const result = await extractScannedPdfWithOcr(Buffer.from('%PDF-1.4 synthetic'), 9_000, 2)
    assert.equal(result.success, false)
    assert.match(result.error || '', /OCR is disabled/)
  } finally {
    if (previous === undefined) delete process.env.ENABLE_OCR
    else process.env.ENABLE_OCR = previous
  }
})

test('optional headless recovery exposes strict concurrency, rate, and timeout budgets', () => {
  const capabilities = headlessRecoveryCapabilities()
  assert.equal(capabilities.maxConcurrency, 1)
  assert.ok(capabilities.maxPerMinute <= 8)
  assert.ok(capabilities.timeoutMs <= 8_000)
})
