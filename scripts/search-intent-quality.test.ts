import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyLens } from '../src/lib/intelligence'
import { filterIntentCandidates } from '../src/app/api/search/route'
import type { ScrapedResult } from '../src/types/search'

function result(title: string, url: string, description: string): ScrapedResult {
  return {
    title,
    url,
    description,
    domain: new URL(url).hostname.replace(/^www\./, ''),
    source: 'Bing',
    rank: 1,
    score: 50,
  }
}

test('an RFP sentence entered under Web is recognized as procurement intent', () => {
  assert.equal(classifyLens('Occupational Health Services RFP'), 'procurement')
  assert.equal(classifyLens('request for proposal occupational medicine services'), 'procurement')
})

test('procurement intent rejects definitions, handbooks, licensing, and therapy pages', () => {
  const candidates = [
    result(
      'OCCUPATIONAL Definition & Meaning - Merriam-Webster',
      'https://www.merriam-webster.com/dictionary/occupational',
      'Definition and meaning of occupational.'
    ),
    result(
      'A-Z Index: Occupational Outlook Handbook',
      'https://www.bls.gov/ooh/a-z-index.htm',
      'An index of occupations and handbook topics.'
    ),
    result(
      'Occupational Licensing - California DMV',
      'https://www.dmv.ca.gov/portal/vehicle-industry-services/occupational-licensing/',
      'Information about occupational licensing.'
    ),
    result(
      'Occupational Therapy: What It Is',
      'https://health.example.org/occupational-therapy',
      'An overview of occupational therapy and its benefits.'
    ),
  ]

  assert.deepEqual(
    filterIntentCandidates('Occupational Health Services RFP', 'procurement', candidates),
    []
  )
})

test('procurement intent preserves actual opportunities and strongly matching official documents', () => {
  const opportunity = result(
    'Request for Proposals - Occupational Health Services',
    'https://sam.gov/opp/example/view',
    'The agency is accepting proposals for occupational health services. Responses due August 30, 2026.'
  )
  const officialPdf = result(
    'Occupational Health Services',
    'https://county.gov/procurement/documents/occupational-health-services.pdf',
    'County occupational health services document.'
  )

  const filtered = filterIntentCandidates(
    'Occupational Health Services RFP',
    'procurement',
    [opportunity, officialPdf]
  )

  assert.deepEqual(filtered.map(item => item.url), [opportunity.url, officialPdf.url])
})

test('non-procurement lenses are not narrowed by the procurement gate', () => {
  const handbook = result(
    'Occupational Outlook Handbook',
    'https://www.bls.gov/ooh/',
    'Career and occupation information.'
  )
  assert.deepEqual(filterIntentCandidates('occupational outlook', 'web', [handbook]), [handbook])
})
