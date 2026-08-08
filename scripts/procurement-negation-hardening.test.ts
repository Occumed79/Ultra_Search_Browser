import test from 'node:test'
import assert from 'node:assert/strict'
import { hasAffirmativeProcurementEvidence } from '../src/lib/occumed-result-decision'

test('long provider-marketing negation cannot become procurement evidence after 180 characters', () => {
  const padding = 'occupational medicine clinic services employee physicals audiograms spirometry drug testing respirator clearance '.repeat(4)
  const text = `This provider page contains no ${padding}RFP, RFQ, solicitation, tender, bid, procurement notice, or contract opportunity. Call the clinic to schedule an appointment.`
  assert.ok(text.indexOf('RFP') - text.indexOf('contains no') > 180)
  assert.equal(hasAffirmativeProcurementEvidence(text), false)
})

test('affirmative procurement language in a later independent sentence still survives earlier negation', () => {
  const text = 'This page is not an RFP and contains no current bid notice. The agency has now issued a Request for Proposals for occupational health services, with responses due October 30, 2026.'
  assert.equal(hasAffirmativeProcurementEvidence(text), true)
})
