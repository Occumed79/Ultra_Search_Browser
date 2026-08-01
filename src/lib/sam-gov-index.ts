/**
 * SAM.gov Get Opportunities Public API → Occu-Med–relevant index entries
 * https://open.gsa.gov/api/get-opportunities-public-api/
 *
 * Env: SAM_API_KEY or SAM_GOV_API_KEY
 * Structured feed only — not a crawler.
 */

import crypto from 'crypto'
import type { FeedEntry } from './small-web'
import { addFeedSource, storeFeedEntries, updateFeedLastFetched } from './small-web'
import {
  OCCUMED_NAICS,
  OCCUMED_SAM_TITLE_QUERIES,
  isOccuMedRelevant,
} from './occumed-index-filters'

const SAM_SEARCH = 'https://api.sam.gov/opportunities/v2/search'

export const SAM_PTYPES = {
  solicitation: 'o',
  combined: 'k',
  presolicitation: 'p',
  sourcesSought: 'r',
  specialNotice: 's',
  award: 'a',
  justification: 'u',
} as const

export interface SamIngestOptions {
  daysBack?: number
  /** Max records per API call (default 50 to stay under daily limits) */
  limitPerQuery?: number
  /** Max total API calls this run (default 12) */
  maxQueries?: number
}

export function samApiKeyConfigured(): boolean {
  return Boolean(process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY)
}

function getApiKey(): string | null {
  const key = (process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY || '').trim()
  return key || null
}

function formatMmDdYyyy(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${mm}/${dd}/${yyyy}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function entryId(noticeId: string, solNum: string, title: string): string {
  return crypto
    .createHash('sha256')
    .update(`sam.gov|${noticeId}|${solNum}|${title}`)
    .digest('hex')
    .slice(0, 40)
}

function opportunityUrl(row: Record<string, unknown>): string {
  const ui = asString(row.uiLink)
  if (ui.startsWith('http')) return ui
  const noticeId = asString(row.noticeId) || asString(row.noticeid)
  if (noticeId) return `https://sam.gov/opp/${encodeURIComponent(noticeId)}/view`
  const sol = asString(row.solicitationNumber)
  if (sol) return `https://sam.gov/search/?keywords=${encodeURIComponent(sol)}`
  return 'https://sam.gov/opportunities'
}

function mapOpportunity(row: Record<string, unknown>, feedUrl: string, feedTitle: string): FeedEntry | null {
  const title = asString(row.title)
  if (!title) return null

  const noticeId = asString(row.noticeId) || asString(row.noticeid)
  const solNum = asString(row.solicitationNumber)
  const url = opportunityUrl(row)
  const typeLabel = asString(row.type) || asString(row.baseType) || 'Opportunity'
  const org = asString(row.fullParentPathName) || asString(row.organizationName)
  const naics = asString(row.naicsCode)
  const setAside = asString(row.typeOfSetAsideDescription) || asString(row.setAside)
  const deadline = asString(row.responseDeadLine) || asString(row.reponseDeadLine)
  const active = asString(row.active)
  const postedRaw = asString(row.postedDate)
  const postedAt = postedRaw ? new Date(postedRaw.replace(' ', 'T') + (postedRaw.includes('Z') ? '' : 'Z')) : new Date()
  const publishedAt = Number.isNaN(postedAt.getTime()) ? new Date() : postedAt

  const description = [
    typeLabel,
    org && `Agency: ${org}`,
    solNum && `Solicitation: ${solNum}`,
    naics && `NAICS: ${naics}`,
    setAside && `Set-aside: ${setAside}`,
    deadline && `Response deadline: ${deadline}`,
    active && `Active: ${active}`,
  ]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 2000)

  if (!isOccuMedRelevant({ title, description, naics })) return null

  return {
    id: entryId(noticeId || solNum || url, solNum, title),
    url,
    title: title.slice(0, 500),
    description,
    content: description,
    author: org.slice(0, 200),
    publishedAt,
    feedUrl,
    feedTitle,
    category: 'healthcare_procurement',
  }
}

interface SamQuery {
  title?: string
  ncode?: string
}

function buildOccuMedQueries(maxQueries: number): SamQuery[] {
  const queries: SamQuery[] = []
  // Prefer NAICS first (high precision), then title keywords
  for (const ncode of OCCUMED_NAICS) {
    if (queries.length >= maxQueries) break
    queries.push({ ncode })
  }
  for (const title of OCCUMED_SAM_TITLE_QUERIES) {
    if (queries.length >= maxQueries) break
    queries.push({ title })
  }
  return queries
}

async function fetchSamPage(
  apiKey: string,
  postedFrom: string,
  postedTo: string,
  limit: number,
  query: SamQuery
): Promise<Record<string, unknown>[]> {
  const u = new URL(SAM_SEARCH)
  u.searchParams.set('api_key', apiKey)
  u.searchParams.set('postedFrom', postedFrom)
  u.searchParams.set('postedTo', postedTo)
  u.searchParams.set('limit', String(limit))
  u.searchParams.set('offset', '0')
  for (const p of [
    SAM_PTYPES.solicitation,
    SAM_PTYPES.combined,
    SAM_PTYPES.sourcesSought,
    SAM_PTYPES.specialNotice,
    SAM_PTYPES.presolicitation,
  ]) {
    u.searchParams.append('ptype', p)
  }
  if (query.title) u.searchParams.set('title', query.title)
  if (query.ncode) u.searchParams.set('ncode', query.ncode)

  const response = await fetch(u.toString(), {
    signal: AbortSignal.timeout(45_000),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'UltraSearchBrowser/1.0 (procurement-index; github.com/Occumed79/Ultra_Search_Browser)',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`SAM.gov HTTP ${response.status}: ${body.slice(0, 200)}`)
  }

  const payload = asRecord(await response.json())
  const rows = Array.isArray(payload.opportunitiesData)
    ? payload.opportunitiesData
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.results)
        ? payload.results
        : []
  return rows.map(asRecord)
}

/**
 * Fetch Occu-Med–relevant SAM opportunities (multiple targeted API queries).
 */
export async function fetchSamOpportunities(options: SamIngestOptions = {}): Promise<FeedEntry[]> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('SAM_API_KEY (or SAM_GOV_API_KEY) is not configured')
  }

  const daysBack = Math.min(Math.max(options.daysBack ?? 30, 1), 90)
  const limit = Math.min(Math.max(options.limitPerQuery ?? 50, 1), 200)
  const maxQueries = Math.min(Math.max(options.maxQueries ?? 12, 1), 25)

  const to = new Date()
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
  const postedFrom = formatMmDdYyyy(from)
  const postedTo = formatMmDdYyyy(to)

  const sourceUrl = 'https://api.sam.gov/opportunities/v2/search'
  const feedTitle = 'SAM.gov — Occu-Med relevant'
  const byId = new Map<string, FeedEntry>()

  const queries = buildOccuMedQueries(maxQueries)
  for (const q of queries) {
    try {
      const rows = await fetchSamPage(apiKey, postedFrom, postedTo, limit, q)
      for (const row of rows) {
        const mapped = mapOpportunity(row, sourceUrl, feedTitle)
        if (mapped) byId.set(mapped.id, mapped)
      }
    } catch (error) {
      console.warn('SAM query failed', q, error)
      // Stop on hard rate-limit so we don't burn the daily quota
      const msg = error instanceof Error ? error.message : String(error)
      if (/HTTP 429|rate/i.test(msg)) break
    }
  }

  return [...byId.values()]
}

export async function ingestSamGov(
  options: SamIngestOptions = {}
): Promise<{ attempted: boolean; stored: number; skipped?: string; error?: string }> {
  if (!samApiKeyConfigured()) {
    return { attempted: false, stored: 0, skipped: 'SAM_API_KEY not set' }
  }

  const sourceUrl = 'https://api.sam.gov/opportunities/v2/search'
  const feedTitle = 'SAM.gov — Occu-Med relevant'

  try {
    await addFeedSource({
      url: sourceUrl,
      title: feedTitle,
      category: 'healthcare_procurement',
      active: true,
      lastFetched: null,
    })

    const entries = await fetchSamOpportunities(options)
    if (!entries.length) {
      return { attempted: true, stored: 0, error: 'no Occu-Med–relevant opportunities in window' }
    }
    const stored = await storeFeedEntries(entries)
    await updateFeedLastFetched(sourceUrl)
    return { attempted: true, stored }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { attempted: true, stored: 0, error: msg }
  }
}
