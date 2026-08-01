/**
 * SAM.gov Get Opportunities Public API → local index entries
 * https://open.gsa.gov/api/get-opportunities-public-api/
 *
 * Free API key required (Account Details on sam.gov).
 * Env: SAM_API_KEY or SAM_GOV_API_KEY
 *
 * This is a structured feed — not a crawler.
 */

import crypto from 'crypto'
import type { FeedEntry } from './small-web'
import { addFeedSource, storeFeedEntries, updateFeedLastFetched } from './small-web'

const SAM_SEARCH = 'https://api.sam.gov/opportunities/v2/search'

/** Procurement type codes (ptype) */
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
  /** Days of posted history to pull (default 14, max ~365 but we keep small for rate limits) */
  daysBack?: number
  /** Max records per request (API max 1000, default 100) */
  limit?: number
  /** Optional keyword filter */
  title?: string
  /** Optional NAICS filter */
  ncode?: string
  /** Optional ptype filters; default solicitations + combined + sources sought + special */
  ptypes?: string[]
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

function categoryForType(typeLabel: string): string {
  const t = typeLabel.toLowerCase()
  if (t.includes('award')) return 'procurement'
  if (t.includes('health') || t.includes('medical')) return 'healthcare_procurement'
  return 'procurement'
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
    category: categoryForType(typeLabel),
  }
}

/**
 * Fetch one page of SAM opportunities for a date window.
 */
export async function fetchSamOpportunities(options: SamIngestOptions = {}): Promise<FeedEntry[]> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('SAM_API_KEY (or SAM_GOV_API_KEY) is not configured')
  }

  const daysBack = Math.min(Math.max(options.daysBack ?? 14, 1), 90)
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000)
  const to = new Date()
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
  const postedFrom = formatMmDdYyyy(from)
  const postedTo = formatMmDdYyyy(to)

  const ptypes =
    options.ptypes ??
    [SAM_PTYPES.solicitation, SAM_PTYPES.combined, SAM_PTYPES.sourcesSought, SAM_PTYPES.specialNotice]

  const u = new URL(SAM_SEARCH)
  u.searchParams.set('api_key', apiKey)
  u.searchParams.set('postedFrom', postedFrom)
  u.searchParams.set('postedTo', postedTo)
  u.searchParams.set('limit', String(limit))
  u.searchParams.set('offset', '0')
  for (const p of ptypes) u.searchParams.append('ptype', p)
  if (options.title) u.searchParams.set('title', options.title)
  if (options.ncode) u.searchParams.set('ncode', options.ncode)

  // Stable source key without embedding the secret
  const feedUrl = `${SAM_SEARCH}?postedFrom=${postedFrom}&postedTo=${postedTo}&limit=${limit}`
  const feedTitle = 'SAM.gov Contract Opportunities'

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

  const entries: FeedEntry[] = []
  for (const raw of rows) {
    const mapped = mapOpportunity(asRecord(raw), feedUrl, feedTitle)
    if (mapped) entries.push(mapped)
  }
  return entries
}

/**
 * Ingest SAM opportunities into Neon when API key is present.
 * Skips cleanly (no throw) when key is missing so bootstrap still works.
 */
export async function ingestSamGov(
  options: SamIngestOptions = {}
): Promise<{ attempted: boolean; stored: number; skipped?: string; error?: string; totalRecords?: number }> {
  if (!samApiKeyConfigured()) {
    return { attempted: false, stored: 0, skipped: 'SAM_API_KEY not set' }
  }

  const feedTitle = 'SAM.gov Contract Opportunities'
  // Canonical source row (no secret in URL)
  const sourceUrl = 'https://api.sam.gov/opportunities/v2/search'

  try {
    await addFeedSource({
      url: sourceUrl,
      title: feedTitle,
      category: 'procurement',
      active: true,
      lastFetched: null,
    })

    const entries = await fetchSamOpportunities(options)
    // Re-point feedUrl on entries to the stable source URL for FK
    const normalized = entries.map(e => ({ ...e, feedUrl: sourceUrl, feedTitle }))
    if (!normalized.length) {
      return { attempted: true, stored: 0, error: 'empty result set' }
    }
    const stored = await storeFeedEntries(normalized)
    await updateFeedLastFetched(sourceUrl)
    return { attempted: true, stored }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { attempted: true, stored: 0, error: msg }
  }
}
