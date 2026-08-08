import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectPageSignals } from '../src/lib/page-validation'

test('scanned-looking direct procurement documents go to review instead of hard rejection', () => {
  const assessment = inspectPageSignals(
    'RFP',
    'https://county.gov/procurement/RFP-26-104.pdf',
    'https://county.gov/procurement/RFP-26-104.pdf',
    'Occupational Health Services RFP 26-104'
  )

  assert.equal(assessment.availability, 'unsupported')
  assert.match(assessment.reason, /scanned|image-only|manual review/i)
})

test('thin procurement portal shells go to review instead of hard rejection', () => {
  const assessment = inspectPageSignals(
    'Loading opportunity...',
    'https://county.gov/procurement/opportunities/26-104',
    'https://county.gov/procurement/opportunities/26-104',
    'Occupational Health Services'
  )

  assert.equal(assessment.availability, 'unsupported')
  assert.match(assessment.reason, /client-rendered|manual review/i)
})

test('known procurement portal hosts are reviewable when server-rendered content is thin', () => {
  const assessment = inspectPageSignals(
    'Loading...',
    'https://agency.bonfirehub.com/opportunities/12345',
    'https://agency.bonfirehub.com/opportunities/12345',
    'RFP 12345'
  )

  assert.equal(assessment.availability, 'unsupported')
})

test('ordinary thin provider pages remain hard-rejected as thin', () => {
  const assessment = inspectPageSignals(
    'Occupational medicine services',
    'https://clinic.example.com/services/occupational-health',
    'https://clinic.example.com/services/occupational-health',
    'Occupational Health Clinic'
  )

  assert.equal(assessment.availability, 'thin')
})
