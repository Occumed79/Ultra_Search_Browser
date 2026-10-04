/**
 * Federal Register public JSON API → profile-targeted index entries
 * https://www.federalregister.gov/developers/documentation/api/v1
 *
 * Structured feed only — relevance is decided by the canonical Neon profile.
 */

import crypto from 'crypto'
import type { FeedEntry } from './small-web'
import { addFeedSource, storeFeedEntries, updateFeedLastFetched } from './small-web'
import { assessCanonicalRelevance, ensureRelevanceProfile, getRelevanceProfile } from './canonical-relevance'

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

/** Target terms come from the canonical profile; no embedded agency or service preferences. */
export function federalRegisterTargets(maxTargets = 13): FrIngestTarget[] {
  return [...new Set(getRelevanceProfile().categories.flatMap(category => category.explicit))].slice(0, Math.max(1, Math.min(50, maxTargets))).map((term, index) => ({
    id: `fr-profile-${index}`, title: `FR — ${term}`, category: 'procurement', term: `"${term}"`, type: 'NOTICE', perPage: 40,
  }))
}

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

    if (assessCanonicalRelevance({ title, description }).verdict === 'reject') continue

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
      category: 'procurement',
    })
  }

  return entries
}

export async function ingestFederalRegisterTargets(
  requestedTargets?: FrIngestTarget[]
): Promise<{ attempted: number; stored: number; failures: string[]; perTarget: Array<{ id: string; stored: number; error?: string }> }> {
  let stored = 0
  const failures: string[] = []
  await ensureRelevanceProfile()
  const targets = requestedTargets ?? federalRegisterTargets()
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
        perTarget.push({ id: target.id, stored: 0, error: 'no profile-targeted items' })
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
