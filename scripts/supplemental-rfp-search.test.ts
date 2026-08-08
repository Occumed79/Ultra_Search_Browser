import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buyerLanguageRetrievalQueries,
  buyerLanguageSemanticQuery,
} from '../src/lib/occumed-capability-matching'

test('deployment and program-management searches generate distinct index queries', () => {
  const deployment = buyerLanguageRetrievalQueries('Pre-deployment health assessment', 4)
  const management = buyerLanguageRetrievalQueries('Occupational health program management', 4)

  assert.equal(deployment[0], 'Pre-deployment health assessment')
  assert.ok(deployment.some(query =>
    /deployment medical|deployment readiness|medical readiness|contractor medical clearance/i.test(query)
  ))
  assert.equal(management[0], 'Occupational health program management')
  assert.ok(management.some(query =>
    /employee health|medical surveillance program management|provider network coordination|medical review/i.test(query)
  ))
  assert.match(
    buyerLanguageSemanticQuery('Pre-deployment health assessment'),
    /Equivalent buyer language:/
  )
})
