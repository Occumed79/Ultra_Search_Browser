import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCandidatePage } from '../src/lib/page-validation'
import type { ScrapedResult } from '../src/types/search'

function candidate(url: string): ScrapedResult {
  return {
    title: 'Public result',
    url,
    description: 'Public result description',
    domain: new URL(url).hostname,
    source: 'Bing',
    rank: 1,
    score: 50,
  }
}

test('page validator refuses redirects into private networks', async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/internal' },
    })
  }) as typeof fetch

  const result = await validateCandidatePage(
    candidate('https://public.example.com/document'),
    'web',
    'public result',
    { fetchImpl, bypassCache: true }
  )

  assert.equal(calls, 1)
  assert.equal(result.availability, 'error')
  assert.match(result.reason, /private\/local/)
})

test('HTTP 403 remains uncertain instead of being classified as junk', async () => {
  const fetchImpl = (async () => new Response('Forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain' },
  })) as typeof fetch

  const result = await validateCandidatePage(
    candidate('https://public.example.com/blocked'),
    'web',
    'public result',
    { fetchImpl, bypassCache: true }
  )

  assert.equal(result.availability, 'error')
  assert.equal(result.lifecycle.status, 'unknown')
  assert.match(result.reason, /could not be verified/)
})
