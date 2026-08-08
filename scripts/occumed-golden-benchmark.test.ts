import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evaluateOccuMedResult } from '../src/lib/occumed-result-decision'
import type { PageAvailability } from '../src/lib/page-validation'
import type { ResultStatusAssessment } from '../src/lib/result-status'
import type { ScrapedResult } from '../src/types/search'

type ExpectedDecision = 'SHOW' | 'REVIEW' | 'REJECT'
interface GoldenCase {
  id: string
  expected: ExpectedDecision
  category: string
  status: ResultStatusAssessment['status']
  availability: PageAvailability
  title: string
  text: string
}

const fixturePath = fileURLToPath(new URL('./fixtures/occumed-golden-benchmark.json', import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { version: string; cases: GoldenCase[] }

function makeResult(item: GoldenCase, index: number): ScrapedResult {
  const procurementPath = item.category === 'not-procurement' ? '/services/occupational-health' : `/procurement/${item.id}`
  const url = `https://golden-${index}.example.gov${procurementPath}`
  const validationStatus = item.expected === 'REVIEW' ? 'uncertain' : 'valid'
  const availabilityReason = item.availability === 'reachable'
    ? 'The destination is reachable and contains substantive public content.'
    : item.availability === 'unsupported'
      ? 'The procurement document or client-rendered portal requires manual evidence review.'
      : item.availability === 'blocked'
        ? 'The destination returned a bot challenge or access-denied page.'
        : item.availability === 'login'
          ? 'The destination requires vendor portal authentication.'
          : item.availability === 'dead'
            ? 'The destination is dead.'
            : 'The destination could not be independently verified.'

  return {
    title: item.title,
    url,
    description: item.text,
    domain: `golden-${index}.example.gov`,
    source: 'Golden benchmark',
    rank: index + 1,
    score: 90,
    bucket: item.expected === 'SHOW' ? 'valid' : item.expected === 'REVIEW' ? 'uncertain' : 'rejected',
    validation: {
      status: validationStatus,
      relevance: item.expected === 'SHOW' ? 0.95 : item.expected === 'REVIEW' ? 0.55 : 0.2,
      reason: item.expected === 'REVIEW' ? 'Golden case intentionally requires review.' : 'Golden benchmark evidence classification.',
      matchedConcepts: [],
      mode: 'local-rules',
    },
    pageValidation: {
      checkedAt: '2026-08-08T00:00:00.000Z',
      requestedUrl: url,
      finalUrl: url,
      httpStatus: item.availability === 'dead' ? 404 : 200,
      contentType: item.id.includes('scanned') ? 'application/pdf' : 'text/html',
      availability: item.availability,
      reason: availabilityReason,
      evidence: [item.text],
      extractedText: item.availability === 'unsupported' ? '' : item.text,
      extractedTextLength: item.availability === 'unsupported' ? 0 : item.text.length,
      cached: false,
      lifecycle: {
        status: item.status,
        reason: item.status === 'open' || item.status === 'active'
          ? 'The procurement is currently accepting responses.'
          : item.status === 'unknown'
            ? 'The response deadline and current open status could not be confirmed.'
            : `The opportunity is ${item.status}.`,
        confidence: item.status === 'unknown' ? 0.5 : 0.97,
        dates: [],
      },
    },
  }
}

test('locked Occu-Med golden benchmark preserves precision, recall, and review safety', () => {
  assert.match(fixture.version, /^2026-08-08\./)
  assert.ok(fixture.cases.length >= 40, `golden corpus unexpectedly shrank to ${fixture.cases.length} cases`)

  const outcomes = fixture.cases.map((item, index) => ({ item, decision: evaluateOccuMedResult(makeResult(item, index)) }))
  const expectedShow = outcomes.filter(({ item }) => item.expected === 'SHOW')
  const expectedReview = outcomes.filter(({ item }) => item.expected === 'REVIEW')
  const expectedReject = outcomes.filter(({ item }) => item.expected === 'REJECT')

  const showRecall = expectedShow.filter(({ decision }) => decision.decision === 'SHOW').length / expectedShow.length
  const negativeLeakage = outcomes.filter(({ item, decision }) => item.expected !== 'SHOW' && decision.decision === 'SHOW')
  const reviewSafety = expectedReview.filter(({ decision }) => decision.decision !== 'SHOW').length / expectedReview.length
  const rejectAccuracy = expectedReject.filter(({ decision }) => decision.decision === 'REJECT').length / expectedReject.length

  const mismatches = outcomes
    .filter(({ item, decision }) => item.expected !== decision.decision)
    .map(({ item, decision }) => `${item.id}: expected ${item.expected}, got ${decision.decision} (${decision.reason})`)

  assert.ok(showRecall >= 0.90, `SHOW recall ${(showRecall * 100).toFixed(1)}% fell below 90%.\n${mismatches.join('\n')}`)
  assert.equal(negativeLeakage.length, 0, `non-SHOW cases leaked into SHOW:\n${negativeLeakage.map(({ item, decision }) => `${item.id}: ${decision.reason}`).join('\n')}`)
  assert.equal(reviewSafety, 1, 'uncertain/unverifiable cases must never be promoted directly to SHOW')
  assert.ok(rejectAccuracy >= 0.90, `REJECT accuracy ${(rejectAccuracy * 100).toFixed(1)}% fell below 90%.\n${mismatches.join('\n')}`)
})

test('golden corpus spans the major Occu-Med pursuit and failure families', () => {
  const categories = new Set(fixture.cases.map(item => item.category))
  for (const category of ['active-fit', 'hard-exclusion', 'not-procurement', 'unverifiable', 'unknown-status', 'ambiguous-fit', 'expired']) {
    assert.ok(categories.has(category), `golden corpus is missing ${category}`)
  }
  const allText = fixture.cases.map(item => `${item.title} ${item.text}`).join(' ').toLowerCase()
  for (const phrase of ['medical surveillance', 'audiometric', 'respirator', 'drug and alcohol', 'deployment medical', 'employee medical examinations', 'provider-network', 'oconus']) {
    assert.ok(allText.includes(phrase), `golden corpus is missing capability family: ${phrase}`)
  }
})
