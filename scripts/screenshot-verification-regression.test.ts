import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCandidatePage } from '../src/lib/page-validation'
import { classifyResultStatus } from '../src/lib/result-status'
import { evaluateCanonicalResult } from '../src/lib/canonical-result-decision'
import { extractRfpOpportunityIntelligence, structuredRfpReviewText } from '../src/lib/rfp-opportunity-intelligence'
import { extractFromHTML } from '../src/lib/document-extraction'
import { inspectSolicitationPackage } from '../src/lib/solicitation-package'
import { isVerifiedOpportunity } from '../src/lib/verified-results'
import type { ScrapedResult } from '../src/types/search'

const candidate: ScrapedResult = {
  title: 'ITB 26-S-007 Addendum 1 Occupational Health Services - Pulaski County Bid & RFP | Starbridge',
  url: 'https://starbridge.ai/rfp/itb-26-s-007',
  description: 'Pre-employment physical screenings, drug and alcohol testing.',
  domain: 'starbridge.ai', source: 'SearXNG', rank: 1, score: 80,
}

test('a Closed badge and closing-date label override a future date', () => {
  const now = new Date('2026-10-06T05:49:00Z')
  for (const text of [
    'CLOSED ITB 26-S-007 Occupational Health Services. Closes Oct 6, 2026.',
    'ITB 26-S-007 Occupational Health Services. Closes Oct 6, 2026 (Closed).',
    'Opportunity status: Closed. Responses due October 16, 2026.',
  ]) assert.equal(classifyResultStatus(text, 'procurement', now).status, 'closed')
  assert.equal(classifyResultStatus('RFP medical evaluations. A closed fracture assessment is required. Responses due October 16, 2026.', 'procurement', now).status, 'open')
})

test('tight HTML Closed badge stays closed through extraction, package analysis and canonical gate', async () => {
  const page = await validateCandidatePage(candidate, 'procurement', 'pre employment exam', {
    bypassCache: true,
    fetchImpl: (async () => new Response(`<html><head><title>${candidate.title}</title></head><body><span>CLOSED</span><h1>ITB 26-S-007 Occupational Health Services</h1><p>Pulaski County is seeking proposals for pre-employment physical screenings, drug and alcohol testing, and physical performance testing.</p><div>Buyer Pulaski County County · AR, US</div><p>Closes Oct 6, 2099 (Closed)</p></body></html>`, { headers: { 'Content-Type': 'text/html' } })) as typeof fetch,
  })
  assert.equal(page.availability, 'reachable')
  assert.equal(page.lifecycle.status, 'closed')
  assert.equal(page.rfpIntelligence?.organization, 'Pulaski County')
  assert.equal(page.rfpIntelligence?.solicitationNumber, '26-S-007')
  assert.equal(page.rfpIntelligence?.opportunityType, 'IFB')
  assert.equal(evaluateCanonicalResult({ ...candidate, pageValidation: page }).decision, 'REJECT')
})

test('agency listing cannot borrow scope, dates or attachments from separate bids', async () => {
  const listing = { ...candidate, title: 'Bid Express :: Municipality of Anchorage', url: 'https://www.bidexpress.com/businesses/85766/home?agency=true&page=2' }
  let fetched = 0
  const page = await validateCandidatePage(listing, 'procurement', 'pre employment exam', {
    bypassCache: true,
    fetchImpl: (async () => {
      fetched++
      return new Response('<html><body><h1>Municipality of Anchorage</h1><p>Open bids: RFP employee medical exams due October 16, 2099. Separate road construction bid, separate emergency maintenance bid, separate office supplies bid.</p><a href="/solicitations/123">RFP documents</a></body></html>', { headers: { 'Content-Type': 'text/html' } })
    }) as typeof fetch,
  })
  assert.equal(fetched, 1)
  assert.equal(page.availability, 'search-page')
  assert.equal(page.packageAnalysis, undefined)
  // Also guard old cached assessments incorrectly marked reachable/open.
  assert.equal(evaluateCanonicalResult({ ...listing, pageValidation: { ...page, availability: 'reachable', lifecycle: { status: 'open', reason: 'Future date', confidence: .9, dates: [] } } }).decision, 'REJECT')
})

test('document links are counted separately from successful extraction', () => {
  const intelligence = extractRfpOpportunityIntelligence({
    url: candidate.url, title: candidate.title, text: candidate.description,
    lifecycle: { status: 'open', reason: 'Future deadline', confidence: .9, dates: [] },
    documents: [
      { url: candidate.url, kind: 'primary', extracted: true, textLength: 500 },
      { url: 'https://example.gov/attachment.pdf', kind: 'attachment', extracted: false, textLength: 0, reason: 'Login required' },
    ],
  })
  assert.equal(intelligence.documentUrls.length, 2)
  assert.equal(intelligence.extractedDocumentCount, 1)
  assert.match(structuredRfpReviewText(intelligence), /Document links: 2\. Documents extracted: 1/)
})

test('a detail notice excludes navigation and active alternatives from text, dates, hydration and attachments', async () => {
  const document = extractFromHTML(`<html><head><title>Occupational Health Services</title></head><body><nav><a href="/catalog/rfp">RFP catalog</a></nav><span>Closed</span><h1 data-opportunity-detail-title="true">ITB 26-S-007 Occupational Health Services</h1><dl><dt>Buyer</dt><dd><span data-buyer-logo="true" aria-hidden="true">PC</span>Pulaski County</dd><dt>Closes</dt><dd>Oct 6, 2026 (Closed)</dd></dl><p>Pre-employment medical exams and drug testing for county employees.</p><a href="/files/addendum.pdf">Addendum 1</a><section data-similar-opportunities-section="true"><h2>Active alternatives</h2><p>Construction proposals due December 31, 2099</p><a href="/rfp/unrelated-construction">Construction RFP</a></section><script type="application/json">{"relatedBid":"Construction proposals due December 31, 2099"}</script></body></html>`, candidate.url)
  assert.match(document.text, /Buyer Pulaski County/)
  assert.doesNotMatch(document.text, /Construction|2099|RFP catalog/)
  assert.deepEqual(document.links?.map(link => link.url), ['https://starbridge.ai/files/addendum.pdf'])
  const opened: string[] = []
  await inspectSolicitationPackage(candidate.url, document, { fetchImpl: async input => {
    opened.push(String(input))
    return new Response('Unavailable', { status: 404 })
  } })
  assert.deepEqual(opened, ['https://starbridge.ai/files/addendum.pdf'])
})

test('attachment requests stop with the page budget instead of extending validation', async () => {
  const document = extractFromHTML('<body><p>Occupational Health Services RFP</p><a href="/files/rfp.pdf">RFP attachment</a></body>', candidate.url)
  let opened = 0
  const packageAnalysis = await inspectSolicitationPackage(candidate.url, document, {
    signal: AbortSignal.abort(),
    fetchImpl: async () => { opened++; return new Response('unrelated') },
  })
  assert.equal(opened, 0)
  assert.equal(packageAnalysis.inspectedCount, 0)
  assert.equal(packageAnalysis.failedCount, 1)
  assert.equal(packageAnalysis.documents[1].extracted, false)
})

test('search snippets, timeless documents and unfinished decisions cannot receive an opportunity badge', () => {
  const page = {
    checkedAt: '2026-10-06T00:00:00Z', requestedUrl: candidate.url, finalUrl: candidate.url,
    availability: 'reachable' as const, reason: 'Public notice opened', evidence: ['Response deadline'], extractedTextLength: 500, cached: false,
    lifecycle: { status: 'open' as const, reason: 'Future deadline', confidence: .9, dates: [] },
  }
  const valid = { ...candidate, bucket: 'valid' as const, validation: { status: 'valid' as const, relevance: 1, reason: 'Scope matched', matchedConcepts: [], mode: 'local-rules' as const }, pageValidation: page, canonicalDecision: { decision: 'SHOW' } }
  assert.equal(isVerifiedOpportunity(valid), true)
  assert.equal(isVerifiedOpportunity({ ...valid, pageValidation: undefined }), false)
  assert.equal(isVerifiedOpportunity({ ...valid, canonicalDecision: undefined }), false)
  assert.equal(isVerifiedOpportunity({ ...valid, pageValidation: { ...page, lifecycle: { ...page.lifecycle, status: 'unknown' } } }), false)
  assert.equal(isVerifiedOpportunity({ ...valid, pageValidation: { ...page, lifecycle: { ...page.lifecycle, status: 'closed' } } }), false)
})
