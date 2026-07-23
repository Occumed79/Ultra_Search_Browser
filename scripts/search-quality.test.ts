import test from 'node:test'
import assert from 'node:assert/strict'
import {
  conceptCoverage,
  dcgAtK,
  duplicateRate,
  evaluateSearchQuality,
  isOfficialResult,
  isPdfResult,
  isStaleYearOnly,
  ndcgAtK,
  reciprocalRank,
} from '../src/lib/search-quality'

const result = (title: string, url: string, description = '', source = 'test') => ({
  title,
  url,
  description,
  source,
})

test('graded relevance metrics reward useful results near the top', () => {
  const strongFirst = [3, 2, 1, 0]
  const strongLast = [0, 1, 2, 3]

  assert.ok(dcgAtK(strongFirst, 4) > dcgAtK(strongLast, 4))
  assert.equal(ndcgAtK(strongFirst, 4), 1)
  assert.ok((ndcgAtK(strongLast, 4) ?? 0) < 1)
  assert.equal(reciprocalRank([0, 0, 2, 3]), 1 / 3)
})

test('duplicate measurement ignores tracking parameters and fragments', () => {
  const results = [
    result('One', 'https://example.com/page?utm_source=x#section'),
    result('Duplicate', 'https://example.com/page'),
    result('Different', 'https://example.com/other'),
  ]

  assert.equal(duplicateRate(results), 1 / 3)
})

test('concept coverage accepts synonyms within each required concept group', () => {
  const score = conceptCoverage(
    result('Occupational medicine solicitation', 'https://example.gov/rfp', 'Responses due August 1'),
    [
      ['occupational health', 'occupational medicine'],
      ['RFP', 'solicitation'],
      ['deadline', 'responses due'],
    ]
  )

  assert.equal(score, 1)
})

test('official, PDF, and stale-year detection are deterministic', () => {
  assert.equal(isOfficialResult(result('Rule', 'https://www.osha.gov/laws-regs')), true)
  assert.equal(isPdfResult(result('Document', 'https://example.gov/files/rfp.pdf?download=1')), true)
  assert.equal(isStaleYearOnly(result('RFP 2022', 'https://example.gov/2022', 'Closed in 2022'), 2026), true)
  assert.equal(isStaleYearOnly(result('RFP 2022 updated 2026', 'https://example.gov/item', 'Updated 2026'), 2026), false)
})

test('evaluation reports proxy metrics and optional manual judgments without changing ranking', () => {
  const results = [
    result('OSHA respirator medical evaluation', 'https://osha.gov/respiratory-protection', 'Official medical clearance guidance', 'bing'),
    result('Respirator products', 'https://shop.example.com/respirators', 'Shopping guide', 'duckduckgo'),
    result('Older OSHA guide 2021', 'https://archive.example.org/2021.pdf', 'Respiratory protection 2021', 'bing'),
  ]

  const evaluation = evaluateSearchQuality({
    id: 'case',
    query: 'OSHA respirator medical evaluation',
    lens: 'government',
    requiredConcepts: [['OSHA'], ['respirator'], ['medical evaluation', 'medical clearance']],
    preferredDomains: ['osha.gov'],
    expectOfficial: true,
    expectPdf: true,
    forbiddenTerms: ['shopping'],
  }, results, [
    { match: 'domain:osha.gov', grade: 3 },
    { match: 'archive.example.org', grade: 1 },
  ], 2026)

  assert.equal(evaluation.resultCount, 3)
  assert.equal(evaluation.preferredDomainHitRank, 1)
  assert.equal(evaluation.officialHitRank, 1)
  assert.equal(evaluation.pdfHitRank, 3)
  assert.equal(evaluation.topResultConceptCoverage, 1)
  assert.equal(evaluation.judgedResultCount, 2)
  assert.equal(evaluation.reciprocalRank, 1)
  assert.ok((evaluation.ndcgAt10 ?? 0) > 0.9)
  assert.ok(evaluation.forbiddenResultRate > 0)
  assert.ok(evaluation.staleResultRate > 0)
})
