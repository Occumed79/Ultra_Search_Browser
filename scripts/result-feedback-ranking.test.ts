import test from 'node:test'
import assert from 'node:assert/strict'
import { feedbackScoreAdjustment } from '../src/lib/result-feedback-ranking'

test('one useful mark has a modest positive effect', () => {
  assert.equal(feedbackScoreAdjustment(1, 0), 3.6)
})

test('repeated consistent useful feedback reaches the positive cap', () => {
  assert.equal(feedbackScoreAdjustment(5, 0), 18)
  assert.equal(feedbackScoreAdjustment(20, 0), 18)
})

test('repeated bad feedback lowers the exact result', () => {
  assert.equal(feedbackScoreAdjustment(0, 5), -18)
})

test('mixed feedback reflects both direction and confidence', () => {
  assert.equal(feedbackScoreAdjustment(3, 2), 3.6)
  assert.equal(feedbackScoreAdjustment(1, 1), 0)
})

test('invalid and empty counts do not create an adjustment', () => {
  assert.equal(feedbackScoreAdjustment(0, 0), 0)
  assert.equal(feedbackScoreAdjustment(-10, -4), 0)
})
