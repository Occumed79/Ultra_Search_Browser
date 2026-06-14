// ─── SMALL WEB ENRICHMENT LAYER ───
// Curated RSS/Atom/blog index for non-commercial content

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

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for small web enrichment')
    }
    pool = new PgPool({ connectionString: databaseUrl })
  }
  return pool
}

/**
 * Initialize small web tables
 */
export async function initializeSmallWeb(): Promise<void> {
  const client = getPool()
  try {
    // Feed sources table
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

    // Feed entries table
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

    // Indexes for fast search
    await client.query(`
      CREATE INDEX IF NOT EXISTS feed_entries_content_idx 
      ON feed_entries USING gin(to_tsvector('english', title || ' ' || description || ' ' || COALESCE(content, '')))
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS feed_entries_category_idx 
      ON feed_entries (category)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS feed_entries_published_idx 
      ON feed_entries (published_at DESC)
    `)

    console.log('Small web tables initialized')
  } catch (error) {
    console.error('Failed to initialize small web tables:', error)
    throw error
  }
}

/**
 * Add a feed source
 */
export async function addFeedSource(source: FeedSource): Promise<void> {
  const client = getPool()
  try {
    await client.query(
      `
      INSERT INTO feed_sources (url, title, category, active, last_fetched)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (url) DO UPDATE SET
        title = EXCLUDED.title,
        category = EXCLUDED.category,
        active = EXCLUDED.active,
        last_fetched = EXCLUDED.last_fetched
      `,
      [source.url, source.title, source.category, source.active, source.lastFetched]
    )
  } catch (error) {
    console.error('Failed to add feed source:', error)
    throw error
  }
}

/**
 * Fetch and parse RSS/Atom feed
 */
export async function fetchFeed(feedUrl: string): Promise<FeedEntry[]> {
  try {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'UltraSearchBrowser/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`Feed fetch error: ${response.status}`)
    }

    const text = await response.text()
    
    // Simple XML parsing for RSS/Atom
    // In production, use a proper XML parser like 'fast-xml-parser' or 'rss-parser'
    const entries: FeedEntry[] = []
    
    // Try to parse as RSS
    const items = text.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || []
    const channelTitle = text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || feedUrl
    
    items.forEach((item, index) => {
      const title = item.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || ''
      const link = item.match(/<link[^>]*>([^<]+)<\/link>/i)?.[1] || 
                   item.match(/<link[^>]*href="([^"]+)"/i)?.[1] || ''
      const description = item.match(/<description[^>]*>([^<]+)<\/description>/i)?.[1] || ''
      const pubDate = item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i)?.[1] || ''
      const author = item.match(/<author[^>]*>([^<]+)<\/author>/i)?.[1] || ''
      
      if (title && link) {
        entries.push({
          id: `${feedUrl}-${index}`,
          url: link,
          title,
          description: description.replace(/<[^>]*>/g, ''),
          content: description.replace(/<[^>]*>/g, ''),
          author,
          publishedAt: pubDate ? new Date(pubDate) : new Date(),
          feedUrl,
          feedTitle: channelTitle,
          category: 'general',
        })
      }
    })

    return entries
  } catch (error) {
    console.error(`Failed to fetch feed ${feedUrl}:`, error)
    return []
  }
}

/**
 * Store feed entries in database
 */
export async function storeFeedEntries(entries: FeedEntry[]): Promise<void> {
  const client = getPool()
  try {
    for (const entry of entries) {
      await client.query(
        `
        INSERT INTO feed_entries (id, url, title, description, content, author, published_at, feed_url, feed_title, category)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          content = EXCLUDED.content,
          published_at = EXCLUDED.published_at
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
    }
  } catch (error) {
    console.error('Failed to store feed entries:', error)
    throw error
  }
}

/**
 * Search small web entries
 */
export async function searchSmallWeb(query: string, category?: string, limit: number = 10): Promise<FeedEntry[]> {
  const client = getPool()
  try {
    let sql = `
      SELECT id, url, title, description, content, author, published_at, feed_url, feed_title, category
      FROM feed_entries
      WHERE to_tsvector('english', title || ' ' || description || ' ' || COALESCE(content, '')) @@ plainto_tsquery('english', $1)
    `
    const params: any[] = [query]
    
    if (category) {
      sql += ` AND category = $2`
      params.push(category)
    }
    
    sql += ` ORDER BY published_at DESC LIMIT $${params.length + 1}`
    params.push(limit)
    
    const result = await client.query(sql, params)
    
    return result.rows.map(row => ({
      id: row.id,
      url: row.url,
      title: row.title,
      description: row.description,
      content: row.content,
      author: row.author,
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

/**
 * Get all feed sources
 */
export async function getFeedSources(): Promise<FeedSource[]> {
  const client = getPool()
  try {
    const result = await client.query('SELECT url, title, category, active, last_fetched FROM feed_sources WHERE active = true')
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

/**
 * Update feed source last fetched time
 */
export async function updateFeedLastFetched(feedUrl: string): Promise<void> {
  const client = getPool()
  try {
    await client.query(
      'UPDATE feed_sources SET last_fetched = NOW() WHERE url = $1',
      [feedUrl]
    )
  } catch (error) {
    console.error('Failed to update feed last fetched:', error)
  }
}

/**
 * Fetch all active feeds and store entries
 */
export async function fetchAllFeeds(): Promise<void> {
  const sources = await getFeedSources()
  
  for (const source of sources) {
    try {
      const entries = await fetchFeed(source.url)
      if (entries.length > 0) {
        await storeFeedEntries(entries)
        await updateFeedLastFetched(source.url)
        console.log(`Fetched ${entries.length} entries from ${source.title}`)
      }
    } catch (error) {
      console.error(`Failed to fetch feed ${source.url}:`, error)
    }
  }
}
