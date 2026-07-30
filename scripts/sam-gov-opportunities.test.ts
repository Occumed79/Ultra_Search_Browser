import test from 'node:test'
import assert from 'node:assert/strict'
import {
  samGovOpportunityCapabilities,
  searchSamGovOpportunities,
} from '../src/lib/sam-gov-opportunities'
import { buildProcurementTitleQueries } from '../src/lib/procurement-rescue-queries'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('SAM.gov opportunity search remains disabled without an API key', async () => {
  assert.equal(samGovOpportunityCapabilities({}).configured, false)
  const search = await searchSamGovOpportunities(
    ['Occupational Health Services'],
    {},
    async () => {
      throw new Error('fetch should not run')
    }
  )
  assert.equal(search.results.length, 0)
  assert.equal(search.diagnostics.attemptedRequests, 0)
})

test('SAM.gov opportunity search returns active public opportunity pages', async () => {
  let requestedUrl = new URL('https://example.test')
  const search = await searchSamGovOpportunities(
    ['Occupational Health Services'],
    { SAM_GOV_API_KEY: 'sam-test-key' },
    async input => {
      requestedUrl = new URL(String(input))
      return jsonResponse({
        opportunitiesData: [{
          noticeId: 'abc-123',
          title: 'Occupational Health Services',
          solicitationNumber: 'RFP-2026-17',
          fullParentPathName: 'DEPARTMENT OF EXAMPLE.EXAMPLE OFFICE',
          postedDate: '2026-07-15',
          type: 'Solicitation',
          responseDeadLine: '2026-08-31T17:00:00-04:00',
          active: 'Yes',
          naicsCode: '621111',
          placeOfPerformance: {
            city: { name: 'Washington' },
            state: { code: 'DC' },
            country: { name: 'United States' },
          },
        }],
      })
    },
    new Date('2026-07-30T12:00:00Z')
  )

  assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://api.sam.gov/opportunities/v2/search')
  assert.equal(requestedUrl.searchParams.get('api_key'), 'sam-test-key')
  assert.equal(requestedUrl.searchParams.get('postedFrom'), '07/31/2025')
  assert.equal(requestedUrl.searchParams.get('postedTo'), '07/30/2026')
  assert.equal(requestedUrl.searchParams.get('title'), 'Occupational Health Services')
  assert.equal(search.results.length, 1)
  assert.equal(search.results[0].source, 'SAM.gov')
  assert.equal(search.results[0].url, 'https://sam.gov/opp/abc-123/view')
  assert.match(search.results[0].description, /RFP-2026-17/)
  assert.match(search.results[0].description, /Responses due/i)
  assert.equal(search.diagnostics.successfulRequests, 1)
  assert.doesNotMatch(JSON.stringify(search), /sam-test-key/)
})

test('SAM.gov opportunity search excludes inactive notices and sanitizes failures', async () => {
  let call = 0
  const search = await searchSamGovOpportunities(
    ['Occupational Health Services', 'Occupational Medicine'],
    { SAM_API_KEY: 'secondary-sam-key' },
    async () => {
      call += 1
      if (call === 1) {
        return jsonResponse({
          opportunitiesData: [{
            noticeId: 'inactive-1',
            title: 'Old Occupational Health Services RFP',
            active: 'No',
          }],
        })
      }
      return jsonResponse({ message: 'invalid key' }, 403)
    }
  )

  assert.equal(search.results.length, 0)
  assert.equal(search.diagnostics.attemptedRequests, 2)
  assert.equal(search.diagnostics.failedRequests, 1)
  assert.match(search.diagnostics.failures[0], /HTTP 403/)
  assert.doesNotMatch(JSON.stringify(search), /secondary-sam-key/)
})

test('procurement title queries preserve the service subject and useful aliases', () => {
  assert.deepEqual(
    buildProcurementTitleQueries('Occupational Health Services RFP'),
    ['Occupational Health Services', 'Occupational Health']
  )
})
