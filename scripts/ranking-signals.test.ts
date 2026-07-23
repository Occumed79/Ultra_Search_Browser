import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateRankingPrecisionSignals,
  lensCompatibilityAdjustment,
  queryRelevanceAdjustment,
} from '../src/lib/ranking-signals'

test('weak query matches receive bounded negative adjustments', () => {
  assert.equal(queryRelevanceAdjustment(0), -26)
  assert.equal(queryRelevanceAdjustment(0.12), -18)
  assert.equal(queryRelevanceAdjustment(0.24), -10)
  assert.equal(queryRelevanceAdjustment(0.4), -4)
  assert.equal(queryRelevanceAdjustment(0.7), 0)
})

test('PDF lens prefers direct PDF documents over ordinary pages', () => {
  const directPdf = lensCompatibilityAdjustment('pdf', {
    title: 'Occupational health fee schedule',
    description: 'Download the current fee schedule.',
    url: 'https://example.gov/files/fee-schedule.pdf',
    domain: 'example.gov',
  })
  const ordinaryPage = lensCompatibilityAdjustment('pdf', {
    title: 'Occupational health services',
    description: 'Information about clinic services.',
    url: 'https://example.com/services',
    domain: 'example.com',
  })

  assert.equal(directPdf, 10)
  assert.equal(ordinaryPage, -18)
})

test('procurement lens penalizes generic and career pages', () => {
  const solicitation = lensCompatibilityAdjustment('procurement', {
    title: 'RFP for occupational health services',
    description: 'Proposals are due August 15.',
    url: 'https://county.gov/procurement/rfp-42',
    domain: 'county.gov',
  })
  const generic = lensCompatibilityAdjustment('procurement', {
    title: 'Occupational health services',
    description: 'Learn about our employee health program.',
    url: 'https://example.org/health',
    domain: 'example.org',
  })
  const career = lensCompatibilityAdjustment('procurement', {
    title: 'Occupational health nurse job opening',
    description: 'Apply now for this employment opportunity.',
    url: 'https://example.org/careers/123',
    domain: 'example.org',
  })

  assert.equal(solicitation, 8)
  assert.equal(generic, -20)
  assert.equal(career, -28)
})

test('pricing lens requires actual price or fee evidence', () => {
  assert.equal(lensCompatibilityAdjustment('pricing', {
    title: 'Self-pay treadmill stress test price',
    description: 'Estimated cash price: $185.',
    url: 'https://clinic.example/pricing',
    domain: 'clinic.example',
  }), 7)

  assert.equal(lensCompatibilityAdjustment('pricing', {
    title: 'Treadmill stress testing',
    description: 'Learn about this diagnostic service.',
    url: 'https://clinic.example/services',
    domain: 'clinic.example',
  }), -16)
})

test('technical lens suppresses obvious retailer collisions', () => {
  assert.equal(lensCompatibilityAdjustment('technical', {
    title: 'Next: shop clothing and homeware',
    description: 'Fashion and accessories. Shop now.',
    url: 'https://next.example/shop',
    domain: 'next.example',
  }), -20)
})

test('combined signals favor a specific standards page over a generic homepage', () => {
  const specific = calculateRankingPrecisionSignals('OSHA 1910.134 respirator fit testing', 'government', {
    title: 'Respiratory Protection Standard 1910.134',
    description: 'OSHA respirator fit testing requirements.',
    url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.134',
    domain: 'osha.gov',
  })
  const generic = calculateRankingPrecisionSignals('OSHA 1910.134 respirator fit testing', 'government', {
    title: 'Occupational Safety and Health Administration',
    description: 'Official workplace safety homepage.',
    url: 'https://www.osha.gov/',
    domain: 'osha.gov',
  })

  assert.ok(specific.totalAdjustment > generic.totalAdjustment)
  assert.ok(specific.queryRelevance > generic.queryRelevance)
})
