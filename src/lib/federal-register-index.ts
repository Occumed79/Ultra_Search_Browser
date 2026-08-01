/**
 * Federal Register public JSON API → Occu-Med–relevant index entries
 * https://www.federalregister.gov/developers/documentation/api/v1
 *
 * Structured feed only — results filtered to occupational health / exam scope.
 */

import crypto from 'crypto'
import type { FeedEntry } from './small-web'
import { addFeedSource, storeFeedEntries, updateFeedLastFetched } from './small-web'
import { isOccuMedRelevant } from './occumed-index-filters'

const FR_JSON = 'https://www.federalregister.gov/api/v1/documents.json'

export interface FrIngestTarget {
  id: string
  title: string
  category: string
  type?: string
  agency?: string
  /** Full-text term search (FR conditions[term]) */
  term?: string
  perPage?: number
}

/**
 * Priority agencies + term searches for Occu-Med scope.
 * Broad “all notices” dumps removed — too much noise.
 */
export const FR_INGEST_TARGETS: FrIngestTarget[] = [
  // Agency lenses (still filtered client-side)
  { id: 'fr-hhs', title: 'FR — HHS (Occu-Med filter)', category: 'healthcare_procurement', agency: 'health-and-human-services-department', type: 'NOTICE', perPage: 50 },
  { id: 'fr-va', title: 'FR — VA (Occu-Med filter)', category: 'healthcare_procurement', agency: 'veterans-affairs-department', type: 'NOTICE', perPage: 50 },
  { id: 'fr-labor', title: 'FR — Labor (Occu-Med filter)', category: 'healthcare_procurement', agency: 'labor-department', type: 'NOTICE', perPage: 50 },
  { id: 'fr-dhs', title: 'FR — DHS (Occu-Med filter)', category: 'healthcare_procurement', agency: 'homeland-security-department', type: 'NOTICE', perPage: 40 },
  { id: 'fr-dod', title: 'FR — Defense (Occu-Med filter)', category: 'healthcare_procurement', agency: 'defense-department', type: 'NOTICE', perPage: 40 },
  { id: 'fr-dot', title: 'FR — Transportation (Occu-Med filter)', category: 'healthcare_procurement', agency: 'transportation-department', type: 'NOTICE', perPage: 40 },
  { id: 'fr-gsa', title: 'FR — GSA (Occu-Med filter)', category: 'healthcare_procurement', agency: 'general-services-administration', type: 'NOTICE', perPage: 40 },
  { id: 'fr-osha', title: 'FR — OSHA / Labor rules', category: 'healthcare_procurement', agency: 'labor-department', type: 'PRORULE', perPage: 30 },
  // Term searches across FR
  { id: 'fr-term-occ-health', title: 'FR term — occupational health', category: 'healthcare_procurement', term: '"occupational health"', type: 'NOTICE', perPage: 40 },
  { id: 'fr-term-med-surv', title: 'FR term — medical surveillance', category: 'healthcare_procurement', term: '"medical surveillance"', type: 'NOTICE', perPage: 30 },
  { id: 'fr-term-drug-test', title: 'FR term — drug testing', category: 'healthcare_procurement', term: '"drug testing"', type: 'NOTICE', perPage: 30 },
  { id: 'fr-term-fit-duty', title: 'FR term — fitness for duty', category: 'healthcare_procurement', term: '"fitness for duty"', type: 'NOTICE', perPage: 20 },
  { id: 'fr-term-respirator', title: 'FR term — respirator medical', category: 'healthcare_procurement', term: '"respirator" medical', type: 'NOTICE', perPage: 20 },
]

function sourceUrl(target: FrIngestTarget): string {
  const u = new URL(FR_JSON)
  if (target.type) u.searchParams.append('conditions[type][]', target.type)
  if (target.agency) u.searchParams.append('conditions[agencies][]', target.agency)
  if (target.term) u.searchParams.set('conditions[term]', target.term)
  u.searchParams.set('per_page', String(target.perPage || 40))
  u.searchParams.set('order', 'newest')
  return u.toString()
}

function entryId(feedUrl: string, docNumber: string, htmlUrl: string): string {
  return crypto.createHash('sha256').update(`${feedUrl}|${docNumber}|${htmlUrl}`).digest('hex').slice(0, 40)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export async function fetchFederalRegisterJson(target: FrIngestTarget): Promise<FeedEntry[]> {
  const feedUrl = sourceUrl(target)
  const response = await fetch(feedUrl, {
    signal: AbortSignal.timeout(25_000),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'UltraSearchBrowser/1.0 (procurement-index; github.com/Occumed79/Ultra_Search_Browser)',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`FR JSON HTTP ${response.status} for ${target.id}`)
  }

  const payload = asRecord(await response.json())
  const results = Array.isArray(payload.results) ? payload.results : []
  const entries: FeedEntry[] = []

  for (const raw of results) {
    const row = asRecord(raw)
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const htmlUrl = typeof row.html_url === 'string' ? row.html_url.trim() : ''
    const docNumber = typeof row.document_number === 'string' ? row.document_number : htmlUrl
    if (!title || !htmlUrl) continue

    const abstract = typeof row.abstract === 'string' ? row.abstract : ''
    const agencies = Array.isArray(row.agencies)
      ? row.agencies
          .map(a => {
            const r = asRecord(a)
            return typeof r.name === 'string' ? r.name : typeof r.raw_name === 'string' ? r.raw_name : ''
          })
          .filter(Boolean)
          .join(', ')
      : ''
    const pub = typeof row.publication_date === 'string' ? new Date(row.publication_date) : new Date()
    const publishedAt = Number.isNaN(pub.getTime()) ? new Date() : pub
    const typeLabel = typeof row.type === 'string' ? row.type : target.type || 'Document'
    const description = [typeLabel, agencies, abstract].filter(Boolean).join(' — ').slice(0, 2000)

    if (!isOccuMedRelevant({ title, description })) continue

    entries.push({
      id: entryId(feedUrl, docNumber, htmlUrl),
      url: htmlUrl,
      title: title.slice(0, 500),
      description,
      content: description,
      author: agencies.slice(0, 200),
      publishedAt,
      feedUrl,
      feedTitle: target.title,
      category: 'healthcare_procurement',
    })
  }

  return entries
}

export async function ingestFederalRegisterTargets(
  targets: FrIngestTarget[] = FR_INGEST_TARGETS
): Promise<{ attempted: number; stored: number; failures: string[]; perTarget: Array<{ id: string; stored: number; error?: string }> }> {
  let stored = 0
  const failures: string[] = []
  const perTarget: Array<{ id: string; stored: number; error?: string }> = []

  for (const target of targets) {
    const feedUrl = sourceUrl(target)
    try {
      await addFeedSource({
        url: feedUrl,
        title: target.title,
        category: target.category,
        active: true,
        lastFetched: null,
      })
      const entries = await fetchFederalRegisterJson(target)
      if (!entries.length) {
        // Not a hard failure — filter may legitimately drop everything
        perTarget.push({ id: target.id, stored: 0, error: 'no Occu-Med–relevant items' })
        continue
      }
      const n = await storeFeedEntries(entries)
      await updateFeedLastFetched(feedUrl)
      stored += n
      perTarget.push({ id: target.id, stored: n })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      failures.push(`${target.title}: ${msg}`)
      perTarget.push({ id: target.id, stored: 0, error: msg })
    }
  }

  return { attempted: targets.length, stored, failures, perTarget }
}
