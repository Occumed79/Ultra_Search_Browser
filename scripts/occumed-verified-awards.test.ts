import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OCCUMED_HISTORICAL_PURSUIT_SEEDS,
  OCCUMED_VERIFIED_AWARD_SEEDS,
  matchOccuMedHistoricalPatterns,
} from '../src/lib/occumed-historical-pursuits'
import {
  OCCUMED_PROFILE_VERSION,
  OCCUMED_VERIFIED_WIN_EXAMPLES,
  assessOccuMedRfpText,
} from '../src/lib/occumed-rfp-profile'
import { evaluateOccuMedResult } from '../src/lib/occumed-result-decision'
import type { ScrapedResult } from '../src/types/search'

const REQUIRED_VERIFIED_AWARDS = [
  '693JK426C600013',
  'W912SV24P0013',
  'W912JC24A0004',
  'W912P523D0011',
  'W9136423A0004',
  '70RCSA22C00000011',
  'W912DW21D1009',
  'W912DW21D1010',
  'W912DW21D1000',
  'W912J220D0004',
  'W912SV19P0022',
  '129JGP18A0014',
  '89503321PWA000145',
] as const

function resultWithLifecycle(text: string, lifecycle: 'open' | 'awarded'): ScrapedResult {
  return {
    title: lifecycle === 'awarded'
      ? 'Contract Award Notice — Occupational Health Medical Surveillance Exams & Lab Services'
      : 'Request for Proposals — Occupational Health Medical Surveillance Exams & Lab Services',
    url: `https://procurement.example.gov/${lifecycle === 'awarded' ? 'awards' : 'solicitations'}/occupational-health`,
    description: text,
    domain: 'procurement.example.gov',
    source: 'Regression fixture',
    rank: 1,
    score: 90,
    validation: {
      status: 'valid',
      relevance: 0.95,
      reason: 'Fixture contains substantive procurement evidence.',
      matchedConcepts: [],
      mode: 'local-rules',
    },
    pageValidation: {
      checkedAt: '2026-08-08T00:00:00.000Z',
      requestedUrl: 'https://procurement.example.gov/occupational-health',
      finalUrl: 'https://procurement.example.gov/occupational-health',
      httpStatus: 200,
      contentType: 'text/html',
      availability: 'reachable',
      reason: 'Substantive procurement record is reachable.',
      evidence: [text],
      extractedTextLength: text.length,
      cached: false,
      lifecycle: {
        status: lifecycle,
        reason: lifecycle === 'open'
          ? 'The response deadline is in the future.'
          : 'The contract has already been awarded.',
        confidence: 0.99,
        dates: [],
      },
    },
  }
}

test('verified award corpus is substantive, traceable, and kept separate from contextual client seeds', () => {
  assert.match(OCCUMED_PROFILE_VERSION, /award-history/)
  assert.ok(OCCUMED_VERIFIED_AWARD_SEEDS.length >= 18, `expected at least 18 verified award/performance records, saw ${OCCUMED_VERIFIED_AWARD_SEEDS.length}`)
  assert.ok(OCCUMED_HISTORICAL_PURSUIT_SEEDS.length > OCCUMED_VERIFIED_AWARD_SEEDS.length, 'contextual client-program seeds should remain available in addition to verified awards')

  const ids = new Set(OCCUMED_VERIFIED_AWARD_SEEDS.map(seed => seed.awardId).filter(Boolean))
  for (const awardId of REQUIRED_VERIFIED_AWARDS) {
    assert.ok(ids.has(awardId), `verified award corpus is missing ${awardId}`)
  }

  for (const seed of OCCUMED_VERIFIED_AWARD_SEEDS) {
    assert.equal(seed.confidence, 'verified-high', `${seed.program} is missing verified-high provenance`)
    assert.ok(seed.publicEvidenceUrl?.startsWith('https://'), `${seed.program} is missing a public evidence URL`)
    assert.ok(seed.servicePatterns.length >= 2, `${seed.program} has too little scope evidence`)
  }
})

test('real award language is recognized as an Occu-Med similarity pattern', () => {
  const text = [
    'The Army National Guard requests job-related medical examinations,',
    'medical surveillance, fitness for duty evaluations, termination exams,',
    'audiology consultations, laboratory testing, and medical review.',
  ].join(' ')
  const matches = matchOccuMedHistoricalPatterns(text)

  assert.ok(matches.some(match => match.awardId === 'W912SV24P0013'), 'Massachusetts ARNG award pattern was not recognized')
  assert.ok(matches.some(match => match.evidenceType === 'verified-prime-award' && match.confidence === 'verified-high'), 'verified prime-award provenance was lost from the match')
})

test('verified win language strengthens active opportunity recognition across proven buyer/service combinations', () => {
  const samples = [
    'Active RFP from a public agency for pre-employment physicals and DOT DMV medical exams.',
    'Army National Guard solicitation for occupational health exams, medical surveillance and audiology consultations.',
    'USACE request for medical surveillance services across multiple locations including laboratory diagnostics, audiometry and spirometry testing.',
    'Federal law enforcement RFQ for pre-employment exams, periodic employee exams, return-to-duty reviews and fitness-for-duty evaluations.',
    'Public-safety solicitation for fitness-for-duty exams for firefighters and periodic occupational medical evaluations.',
  ]

  for (const sample of samples) {
    const assessment = assessOccuMedRfpText(sample)
    assert.equal(assessment.status, 'relevant', `${sample}\n${assessment.reason}`)
  }
  assert.ok(OCCUMED_VERIFIED_WIN_EXAMPLES.length >= 7, 'verified win examples unexpectedly shrank')
})

test('a historical Occu-Med award can teach similarity but can never leak into SHOW', () => {
  const awardText = 'Award of contract W9136423A0004 to Occu-Med for occupational health medical surveillance exams and lab services for the Department of the Army.'
  const result = resultWithLifecycle(awardText, 'awarded')
  const decision = evaluateOccuMedResult(result)

  assert.ok(decision.historicalMatches.some(match => match.awardId === 'W9136423A0004'), 'historical award similarity evidence was not attached')
  assert.equal(decision.decision, 'REJECT', 'an awarded historical contract must never enter the live opportunity list')
  assert.equal(decision.lifecycleStatus, 'awarded')
})

test('the same proven scope remains eligible when it appears in a genuinely open procurement', () => {
  const liveText = 'Request for proposals for occupational health medical surveillance exams and lab services, including periodic employee exams, audiometry and spirometry testing, for an Army workforce.'
  const decision = evaluateOccuMedResult(resultWithLifecycle(liveText, 'open'))

  assert.equal(decision.procurementConfirmed, true)
  assert.equal(decision.activeConfirmed, true)
  assert.equal(decision.noHardDisqualifier, true)
  assert.equal(decision.decision, 'SHOW', decision.reason)
})
