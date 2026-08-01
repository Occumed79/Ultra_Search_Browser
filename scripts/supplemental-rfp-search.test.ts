import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buyerLanguageRetrievalQueries,
  buyerLanguageSemanticQuery,
} from '../src/lib/occumed-capability-matching'
import { searchOccuMedSupplementalSources } from '../src/lib/occumed-supplemental-search'

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

test('supplemental search sends all buyer-language variants to Parallel in one index request', async () => {
  const originalFetch = globalThis.fetch
  const originalParallel = process.env.PARALLEL_API_KEY
  const originalDatabase = process.env.DATABASE_URL
  let requestBody: Record<string, unknown> = {}

  process.env.PARALLEL_API_KEY = 'parallel-test-key'
  delete process.env.DATABASE_URL
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    return new Response(JSON.stringify({
      results: [{
        title: 'Medical Readiness and Contractor Clearance Solicitation',
        url: 'https://procurement.example.gov/readiness-26',
        excerpts: ['Active solicitation for deployment medical screening and contractor medical clearance.'],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const search = await searchOccuMedSupplementalSources(
      'Pre-deployment health assessment',
      { useVectorMemory: false }
    )
    const queries = requestBody.search_queries as string[]
    const objective = String(requestBody.objective || '')

    assert.equal(search.diagnostics.parallel.configured, true)
    assert.equal(search.diagnostics.parallel.successful, true)
    assert.equal(search.results.length, 1)
    assert.equal(queries[0], 'Pre-deployment health assessment')
    assert.ok(queries.some(query =>
      /deployment medical|deployment readiness|medical readiness|contractor medical clearance/i.test(query)
    ))
    assert.match(objective, /Buyers may describe the same requirement as:/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalParallel === undefined) delete process.env.PARALLEL_API_KEY
    else process.env.PARALLEL_API_KEY = originalParallel
    if (originalDatabase === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabase
  }
})
