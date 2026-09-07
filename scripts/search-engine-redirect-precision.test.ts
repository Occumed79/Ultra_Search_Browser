import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBrowserSerpCandidates } from '../src/lib/browser-search-pipeline'
import { applyIntentCandidateGate } from '../src/lib/search-intent-gate'
import { buildDeterministicSemanticIntent } from '../src/lib/semantic-intent'

const LIVE_BING_CLINIC_WRAPPER = 'https://www.bing.com/ck/a?!&&p=feb22092a944339ddcebc1999c11f428f84e9bbe2f8258d359cd09ff3852b80dJmltdHM9MTc4ODczOTIwMA&ptn=3&ver=2&hsh=4&u=a1aHR0cHM6Ly9vaHRlc3Rpbmd1c2EuY29tL29jY3VwYXRpb25hbC1oZWFsdGgtdGVzdGluZy1tb3Nlcy1sYWtlLXdhLw&ntb=1'

test('live Bing wrapper is unwrapped before procurement classification and clinic marketing is rejected', () => {
  const query = 'occupational health services'
  const normalized = normalizeBrowserSerpCandidates([{
    title: 'Occupational Health Testing, Moses Lake, WA – 800-219-7161',
    url: LIVE_BING_CLINIC_WRAPPER,
    description: 'Some occupational health services include employee wellness, Pre-placement services, ergonomics, occupational therapy, and more.',
    source: 'Direct rescue · Bing',
    rank: 1,
    score: 90,
    query: 'occupational health services RFP RFQ solicitation bid tender',
    purpose: 'ai-intent',
  }])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].url, 'https://ohtestingusa.com/occupational-health-testing-moses-lake-wa')
  assert.equal(normalized[0].domain, 'ohtestingusa.com')

  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const gated = applyIntentCandidateGate(query, 'procurement', normalized, intent)
  assert.equal(gated.results.length, 0)
  assert.equal(gated.diagnostics.reasons['missing-procurement-evidence'], 1)
})

test('search-engine wrappers unwrap to real procurement destinations without losing recall', () => {
  const target = 'https://sam.gov/opp/abc123/view'
  const candidates = normalizeBrowserSerpCandidates([
    {
      title: 'Employee Medical Examination Services',
      url: `https://www.bing.com/ck/a?u=${encodeURIComponent(target)}`,
      description: 'Employee medical examination services and related occupational health requirements.',
      source: 'Direct rescue · Bing',
      query: 'employee medical examinations RFP RFQ solicitation bid tender',
      purpose: 'ai-intent',
    },
    {
      title: 'Employee Medical Examination Services',
      url: `https://www.google.com/url?q=${encodeURIComponent(target)}`,
      description: 'Employee medical examination services and related occupational health requirements.',
      source: 'SearXNG · google',
      query: 'employee medical examinations RFP RFQ solicitation bid tender',
      purpose: 'official',
    },
    {
      title: 'Employee Medical Examination Services',
      url: `https://duckduckgo.com/l/?uddg=${encodeURIComponent(target)}`,
      description: 'Employee medical examination services and related occupational health requirements.',
      source: 'SearXNG · duckduckgo',
      query: 'employee medical examinations RFP RFQ solicitation bid tender',
      purpose: 'portal',
    },
  ])

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].url, target)
  assert.equal(candidates[0].domain, 'sam.gov')
  assert.equal(candidates[0].retrieval?.overlap, 3)

  const query = 'employee medical examinations'
  const intent = buildDeterministicSemanticIntent(query, 'procurement')
  const gated = applyIntentCandidateGate(query, 'procurement', candidates, intent)
  assert.equal(gated.results.length, 1)
})

test('recognized search redirect wrappers with no safe destination are dropped', () => {
  const candidates = normalizeBrowserSerpCandidates([
    {
      title: 'Broken Bing redirect',
      url: 'https://www.bing.com/ck/a?p=missing-target',
      description: 'Occupational health procurement',
      source: 'Direct rescue · Bing',
      query: 'occupational health RFP',
      purpose: 'ai-intent',
    },
    {
      title: 'Unsafe Google redirect',
      url: 'https://www.google.com/url?q=javascript%3Aalert(1)',
      description: 'Occupational health procurement',
      source: 'SearXNG · google',
      query: 'occupational health RFP',
      purpose: 'official',
    },
  ])

  assert.equal(candidates.length, 0)
})
