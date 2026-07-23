import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInsightHubOpportunitiesUrl,
  mapInsightHubOpportunity,
} from '../src/lib/insight-hub-source'

test('Insight Hub URL builder targets actionable fresh active opportunities', () => {
  const url = buildInsightHubOpportunitiesUrl(
    'https://insight.example.com',
    'occupational health services RFP',
    25
  )

  assert.equal(url.origin, 'https://insight.example.com')
  assert.equal(url.pathname, '/api/opportunities')
  assert.equal(url.searchParams.get('search'), 'occupational health services RFP')
  assert.equal(url.searchParams.get('view'), 'actionable')
  assert.equal(url.searchParams.get('freshOnly'), 'true')
  assert.equal(url.searchParams.get('status'), 'active')
  assert.equal(url.searchParams.get('limit'), '25')
})

test('Insight Hub URL builder accepts a base URL that already ends in /api', () => {
  const url = buildInsightHubOpportunitiesUrl('https://insight.example.com/api/', 'audiometry bid')
  assert.equal(url.pathname, '/api/opportunities')
})

test('Insight Hub opportunities become procurement search results with evidence', () => {
  const result = mapInsightHubOpportunity({
    title: 'Occupational Health Services RFP',
    description: 'Pre-employment physicals, audiograms, and respirator fit testing',
    agency: 'Example County',
    solicitationNumber: 'RFP-2026-14',
    samUrl: 'https://procurement.example.gov/opportunities/14',
    postedDate: '2026-07-01',
    responseDeadline: '2026-08-15',
    providerName: 'IonWave',
    relevance: {
      score: 92,
      confidence: 'high',
      reasons: ['Occupational-health service match', 'Active deadline'],
    },
  }, 0)

  assert.ok(result)
  assert.equal(result.source, 'Insight Hub · IonWave')
  assert.equal(result.resultType, 'procurement')
  assert.equal(result.domain, 'procurement.example.gov')
  assert.match(result.description, /Example County/)
  assert.match(result.description, /Deadline 2026-08-15/)
  assert.equal(result.intelligence?.document_url, 'https://procurement.example.gov/opportunities/14')
  assert.equal(result.intelligence?.status, 'active')
})

test('Insight Hub rows without a usable title or public URL are rejected', () => {
  assert.equal(mapInsightHubOpportunity({ title: 'Missing URL' }, 0), null)
  assert.equal(mapInsightHubOpportunity({ samUrl: 'https://example.gov/opportunity' }, 0), null)
  assert.equal(mapInsightHubOpportunity({ title: 'Bad URL', samUrl: 'not-a-url' }, 0), null)
})
