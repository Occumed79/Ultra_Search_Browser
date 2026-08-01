/**
 * Federal Register public JSON API → procurement index entries
 * https://www.federalregister.gov/developers/documentation/api/v1
 *
 * More reliable than RSS from some cloud egress IPs.
 */

import crypto from 'crypto'
import type { FeedEntry } from './small-web'
import { addFeedSource, storeFeedEntries, updateFeedLastFetched } from './small-web'

const FR_JSON = 'https://www.federalregister.gov/api/v1/documents.json'

export interface FrIngestTarget {
  /** Stable source key */
  id: string
  title: string
  category: string
  /** FR type: NOTICE | RULE | PRORULE | ... */
  type?: string
  /** FR agency slug e.g. general-services-administration */
  agency?: string
  perPage?: number
}

/** Default targets to load into the local index */
export const FR_INGEST_TARGETS: FrIngestTarget[] = [
  { id: 'fr-json-notices', title: 'FR JSON — Notices', category: 'government', type: 'NOTICE', perPage: 100 },
  { id: 'fr-json-prorule', title: 'FR JSON — Proposed Rules', category: 'government', type: 'PRORULE', perPage: 50 },
  { id: 'fr-json-rule', title: 'FR JSON — Rules', category: 'government', type: 'RULE', perPage: 50 },
  { id: 'fr-json-gsa', title: 'FR JSON — GSA', category: 'procurement', agency: 'general-services-administration', perPage: 50 },
  { id: 'fr-json-hhs', title: 'FR JSON — HHS', category: 'healthcare_procurement', agency: 'health-and-human-services-department', perPage: 50 },
  { id: 'fr-json-va', title: 'FR JSON — VA', category: 'healthcare_procurement', agency: 'veterans-affairs-department', perPage: 50 },
  { id: 'fr-json-dod', title: 'FR JSON — Defense', category: 'procurement', agency: 'defense-department', perPage: 50 },
  { id: 'fr-json-labor', title: 'FR JSON — Labor', category: 'procurement', agency: 'labor-department', perPage: 50 },
  { id: 'fr-json-dhs', title: 'FR JSON — Homeland Security', category: 'procurement', agency: 'homeland-security-department', perPage: 50 },
  { id: 'fr-json-dot', title: 'FR JSON — Transportation', category: 'procurement', agency: 'transportation-department', perPage: 50 },
  { id: 'fr-json-epa', title: 'FR JSON — EPA', category: 'procurement', agency: 'environmental-protection-agency', perPage: 50 },
  { id: 'fr-json-energy', title: 'FR JSON — Energy', category: 'procurement', agency: 'energy-department', perPage: 50 },
  { id: 'fr-json-usda', title: 'FR JSON — Agriculture', category: 'procurement', agency: 'agriculture-department', perPage: 50 },
  { id: 'fr-json-commerce', title: 'FR JSON — Commerce', category: 'procurement', agency: 'commerce-department', perPage: 50 },
  { id: 'fr-json-interior', title: 'FR JSON — Interior', category: 'procurement', agency: 'interior-department', perPage: 50 },
]

function sourceUrl(target: FrIngestTarget): string {
  const u = new URL(FR_JSON)
  if (target.type) u.searchParams.append('conditions[type][]', target.type)
  if (target.agency) u.searchParams.append('conditions[agencies][]', target.agency)
  u.searchParams.set('per_page', String(target.perPage || 50))
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
      category: target.category,
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
        failures.push(`${target.title}: empty result set`)
        perTarget.push({ id: target.id, stored: 0, error: 'empty' })
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
