import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanOpportunityTitle, trustworthyBuyerCandidate } from '../src/lib/procurement-field-cleanup'
import { extractRfpOpportunityIntelligence } from '../src/lib/rfp-opportunity-intelligence'
import type { ResultStatusAssessment } from '../src/lib/result-status'

const lifecycle:ResultStatusAssessment={status:'open',confidence:.9,reason:'test',dates:[]}

test('cleans web-navigation token artifacts without changing the subject of a real bid',()=>{
  const result=cleanOpportunityTitle('Bid Postings • RFP - PRE-EMPLOYMENT PHYSICALS/MEDICAL & DRUGPrintArrow LeftArrow RightSlideshow LeftArrow')
  assert.equal(result,'Bid Postings • RFP - PRE-EMPLOYMENT PHYSICALS/MEDICAL & DRUG')
  assert.equal(cleanOpportunityTitle('Arrow Healthcare Clinic Contract'),'Arrow Healthcare Clinic Contract')
})
test('screenshots: payment/navigation fragments cannot become contracting agencies',()=>{
  assert.equal(trustworthyBuyerCandidate('Texas via direct deposit or change'),undefined)
  assert.equal(trustworthyBuyerCandidate('Proposal Requested The Arvada Fire Protection District'),undefined)
  assert.equal(trustworthyBuyerCandidate('City of Passaic'),'City of Passaic')
  assert.equal(trustworthyBuyerCandidate('Department of Veterans Affairs'),'Department of Veterans Affairs')
})
test('RFP intelligence rejects unsupported buyer despite otherwise relevant scope',()=>{
  const out=extractRfpOpportunityIntelligence({
    url:'https://www.cleat.ai/government/contracts/fictional',
    title:'FY26-FY31 PRE-EMPLOYMENT PHYSICAL EXAMINATIONS',
    lifecycle,
    text:'Buyer: Texas via direct deposit or change. This procurement seeks pre-employment medical physicals, testing, and audiometry.',
  })
  assert.equal(out.organization,undefined)
  assert.equal(out.title,'FY26-FY31 PRE-EMPLOYMENT PHYSICAL EXAMINATIONS')
})
test('RFP intelligence preserves a clear issuer and removes only UI junk from heading',()=>{
  const out=extractRfpOpportunityIntelligence({
    url:'https://www.cityofpassaic.com/bids.aspx?bidID=722',
    title:'RFP - PRE-EMPLOYMENT PHYSICALS/MEDICAL & DRUGPrintArrow LeftArrow RightSlideshow',
    lifecycle,
    text:'Issuing agency: City of Passaic. RFP Number: RFP-722. Occupational medical screenings and laboratory testing.',
  })
  assert.equal(out.organization,'City of Passaic')
  assert.equal(out.title,'RFP - PRE-EMPLOYMENT PHYSICALS/MEDICAL & DRUG')
})
