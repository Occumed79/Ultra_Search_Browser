// ─── SMALL WEB / PROCUREMENT INDEX ───
// Curated index stored in Postgres (Neon) for always-on retrieval

import crypto from 'crypto'
import pg from 'pg'

const { Pool: PgPool } = pg

export interface FeedEntry {
  id: string
  url: string
  title: string
  description: string
  content: string
  author: string
  publishedAt: Date
  feedUrl: string
  feedTitle: string
  category: string
}

export interface FeedSource {
  url: string
  title: string
  category: string
  active: boolean
  lastFetched: Date | null
}

export interface IndexStats {
  sources: number
  activeSources: number
  entries: number
  byCategory: Record<string, number>
  lastFetchedAt: string | null
}

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for small web / procurement index')
    }
    pool = new PgPool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=') || databaseUrl.includes('neon.tech')
        ? { rejectUnauthorized: false }
        : undefined,
      max: 4,
    })
  }
  return pool
}

export async function initializeSmallWeb(): Promise<void> {
  const client = getPool()
  await client.query(`
    CREATE TABLE IF NOT EXISTS feed_sources (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      active BOOLEAN DEFAULT true,
      last_fetched TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS feed_entries (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT,
      author TEXT,
      published_at TIMESTAMP,
      feed_url TEXT NOT NULL,
      feed_title TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT fk_feed FOREIGN KEY (feed_url) REFERENCES feed_sources(url) ON DELETE CASCADE
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS feed_entries_content_idx
    ON feed_entries USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '') || ' ' || COALESCE(content, '')))
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS feed_entries_category_idx ON feed_entries (category)`)
  await client.query(`CREATE INDEX IF NOT EXISTS feed_entries_published_idx ON feed_entries (published_at DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS feed_entries_url_idx ON feed_entries (url)`)
}

export async function addFeedSource(source: FeedSource): Promise<void> {
  const client = getPool()
  await client.query(
    `
    INSERT INTO feed_sources (url, title, category, active, last_fetched)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      active = EXCLUDED.active
    `,
    [source.url, source.title, source.category, source.active, source.lastFetched]
  )
}

function stripTags(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/&/g, '&')
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function tagText(block: string, tag: string): string {
  const cdata = block.match(new RegExp(`<${tag}[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*</${tag}>`, 'i'))
  if (cdata?.[1]) return cdata[1].trim()
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)</${tag}>`, 'i'))
  if (plain?.[1]) return stripTags(plain[1])
  return ''
}

function linkFromBlock(block: string): string {
  const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i)
  if (href?.[1]) return href[1].trim()
  const text = tagText(block, 'link')
  if (text.startsWith('http')) return text
  const guid = tagText(block, 'guid')
  if (guid.startsWith('http')) return guid
  const id = tagText(block, 'id')
  if (id.startsWith('http')) return id
  return ''
}

function stableEntryId(feedUrl: string, url: string, title: string): string {
  return crypto.createHash('sha256').update(`${feedUrl}|${url}|${title}`).digest('hex').slice(0, 40)
}

export function parseFeedXml(xml: string, feedUrl: string, category: string): FeedEntry[] {
  const entries: FeedEntry[] = []
  const channelTitle = tagText(xml.slice(0, 4000), 'title') || feedUrl

  const itemBlocks =
    xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi)
    || xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi)
    || []

  for (const block of itemBlocks) {
    const title = tagText(block, 'title')
    const link = linkFromBlock(block)
    if (!title || !link) continue
    try {
      const parsed = new URL(link)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue
    } catch {
      continue
    }

    const description =
      tagText(block, 'description')
      || tagText(block, 'summary')
      || tagText(block, 'content')
      || ''
    const author =
      tagText(block, 'dc:creator')
      || tagText(block, 'author')
      || tagText(block, 'creator')
      || ''
    const pubRaw =
      tagText(block, 'pubDate')
      || tagText(block, 'published')
      || tagText(block, 'updated')
      || tagText(block, 'dc:date')
      || ''
    const publishedAt = pubRaw ? new Date(pubRaw) : new Date()
    const safeDate = Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt

    entries.push({
      id: stableEntryId(feedUrl, link, title),
      url: link,
      title: title.slice(0, 500),
      description: description.slice(0, 2000),
      content: description.slice(0, 4000),
      author: author.slice(0, 200),
      publishedAt: safeDate,
      feedUrl,
      feedTitle: channelTitle.slice(0, 300),
      category,
    })
  }

  return entries
}

export async function fetchFeed(feedUrl: string, category = 'procurement'): Promise<FeedEntry[]> {
  try {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'UltraSearchBrowser/1.0 (procurement-index; +https://github.com/Occumed79/Ultra_Search_Browser)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      cache: 'no-store',
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`Feed fetch HTTP ${response.status}`)
    }

    const text = await response.text()
    if (/<!DOCTYPE html>/i.test(text) && !/<rss\b|<feed\b/i.test(text)) {
      throw new Error('Feed returned HTML instead of RSS/Atom (blocked or wrong URL)')
    }

    return parseFeedXml(text, feedUrl, category)
  } catch (error) {
    console.error(`Failed to fetch feed ${feedUrl}:`, error)
    return []
  }
}

export async function storeFeedEntries(entries: FeedEntry[]): Promise<number> {
  if (!entries.length) return 0
  const client = getPool()
  let stored = 0
  for (const entry of entries) {
    try {
      await client.query(
        `
        INSERT INTO feed_entries (id, url, title, description, content, author, published_at, feed_url, feed_title, category)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          content = EXCLUDED.content,
          published_at = EXCLUDED.published_at,
          category = EXCLUDED.category
        `,
        [
          entry.id,
          entry.url,
          entry.title,
          entry.description,
          entry.content,
          entry.author,
          entry.publishedAt,
          entry.feedUrl,
          entry.feedTitle,
          entry.category,
        ]
      )
      stored += 1
    } catch (error) {
      console.warn('Failed to store entry', entry.url, error)
    }
  }
  return stored
}

export async function searchSmallWeb(query: string, category?: string, limit: number = 10): Promise<FeedEntry[]> {
  const client = getPool()
  try {
    const params: unknown[] = [query]
    let sql = `
      SELECT id, url, title, description, content, author, published_at, feed_url, feed_title, category
      FROM feed_entries
      WHERE to_tsvector('english', title || ' ' || COALESCE(description, '') || ' ' || COALESCE(content, ''))
            @@ plainto_tsquery('english', $1)
    `
    if (category) {
      if (category === 'procurement') {
        sql += ` AND category = ANY($2::text[])`
        params.push(['procurement', 'grants', 'healthcare_procurement', 'government'])
      } else {
        sql += ` AND category = $2`
        params.push(category)
      }
    }
    sql += ` ORDER BY published_at DESC NULLS LAST LIMIT $${params.length + 1}`
    params.push(limit)

    const result = await client.query(sql, params)
    return result.rows.map(row => ({
      id: row.id,
      url: row.url,
      title: row.title,
      description: row.description || '',
      content: row.content || '',
      author: row.author || '',
      publishedAt: row.published_at,
      feedUrl: row.feed_url,
      feedTitle: row.feed_title,
      category: row.category,
    }))
  } catch (error) {
    console.error('Failed to search small web:', error)
    return []
  }
}

export async function getFeedSources(): Promise<FeedSource[]> {
  const client = getPool()
  try {
    const result = await client.query(
      'SELECT url, title, category, active, last_fetched FROM feed_sources WHERE active = true ORDER BY title'
    )
    return result.rows.map(row => ({
      url: row.url,
      title: row.title,
      category: row.category,
      active: row.active,
      lastFetched: row.last_fetched,
    }))
  } catch (error) {
    console.error('Failed to get feed sources:', error)
    return []
  }
}

export async function updateFeedLastFetched(feedUrl: string): Promise<void> {
  const client = getPool()
  try {
    await client.query('UPDATE feed_sources SET last_fetched = NOW() WHERE url = $1', [feedUrl])
  } catch (error) {
    console.error('Failed to update feed last fetched:', error)
  }
}

export async function fetchAllFeeds(): Promise<{ feeds: number; entries: number; failures: string[] }> {
  const sources = await getFeedSources()
  let entries = 0
  const failures: string[] = []

  for (const source of sources) {
    try {
      const items = await fetchFeed(source.url, source.category)
      if (items.length > 0) {
        const stored = await storeFeedEntries(items)
        entries += stored
        await updateFeedLastFetched(source.url)
        console.log(`Fetched ${items.length} (stored ${stored}) from ${source.title}`)
      } else {
        failures.push(`${source.title}: no parseable items`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      failures.push(`${source.title}: ${msg}`)
      console.error(`Failed to fetch feed ${source.url}:`, error)
    }
  }

  return { feeds: sources.length, entries, failures }
}

export async function getIndexStats(): Promise<IndexStats> {
  const client = getPool()
  const sources = await client.query(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active FROM feed_sources'
  )
  const entries = await client.query('SELECT COUNT(*)::int AS total FROM feed_entries')
  const byCat = await client.query(
    'SELECT category, COUNT(*)::int AS n FROM feed_entries GROUP BY category'
  )
  const last = await client.query(
    'SELECT MAX(last_fetched) AS last FROM feed_sources'
  )
  const byCategory: Record<string, number> = {}
  for (const row of byCat.rows) byCategory[row.category] = row.n
  return {
    sources: sources.rows[0]?.total ?? 0,
    activeSources: sources.rows[0]?.active ?? 0,
    entries: entries.rows[0]?.total ?? 0,
    byCategory,
    lastFetchedAt: last.rows[0]?.last ? new Date(last.rows[0].last).toISOString() : null,
  }
}

/**
 * Bootstrap: tables + Federal Register JSON ingest (primary) + optional RSS seeds.
 */
export async function bootstrapProcurementIndex(): Promise<{
  seeded: number
  fetch: { feeds: number; entries: number; failures: string[] }
  frJson?: { attempted: number; stored: number; failures: string[] }
  stats: IndexStats
}> {
  await initializeSmallWeb()

  // Primary path: Federal Register JSON API (reliable from cloud hosts)
  const { ingestFederalRegisterTargets } = await import('./federal-register-index')
  const fr = await ingestFederalRegisterTargets()

  // Secondary: any remaining active RSS seeds (may be empty if FR-only)
  const { getActiveRssSeeds, rssSeedToFeedSource } = await import('./procurement-index-seeds')
  const seeds = getActiveRssSeeds()
  for (const seed of seeds) {
    await addFeedSource(rssSeedToFeedSource(seed))
  }
  // Skip RSS re-fetch of FR URLs that already failed; only attempt non-FR seeds
  const rssOnly = seeds.filter(s => !s.url.includes('federalregister.gov'))
  let rssEntries = 0
  const rssFailures: string[] = []
  for (const seed of rssOnly) {
    const items = await fetchFeed(seed.url, seed.category === 'grants' ? 'procurement' : seed.category)
    if (items.length) {
      rssEntries += await storeFeedEntries(items)
      await updateFeedLastFetched(seed.url)
    } else {
      rssFailures.push(`${seed.title}: no parseable items`)
    }
  }

  const stats = await getIndexStats()
  return {
    seeded: seeds.length + fr.attempted,
    fetch: {
      feeds: fr.attempted + rssOnly.length,
      entries: fr.stored + rssEntries,
      failures: [...fr.failures, ...rssFailures],
    },
    frJson: { attempted: fr.attempted, stored: fr.stored, failures: fr.failures },
    stats,
  }
}
