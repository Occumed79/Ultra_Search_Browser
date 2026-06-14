#!/usr/bin/env tsx
// ─── BACKGROUND JOB TO FETCH RSS FEEDS ───
// Run this periodically (e.g., via cron) to keep small web index fresh

import { initializeSmallWeb, addFeedSource, fetchAllFeeds, getFeedSources } from '../src/lib/small-web'

// Default feed sources to add
const DEFAULT_FEEDS = [
  {
    url: 'https://www.whitehouse.gov/feed/',
    title: 'White House Briefing Room',
    category: 'government',
    active: true,
    lastFetched: null,
  },
  {
    url: 'https://www.federalregister.gov/api/v1/notice.rss',
    title: 'Federal Register',
    category: 'government',
    active: true,
    lastFetched: null,
  },
  {
    url: 'https://sam.gov/api/prod/sgs/v1/opportunities/rss',
    title: 'SAM.gov Opportunities',
    category: 'procurement',
    active: true,
    lastFetched: null,
  },
]

async function main() {
  console.log('=== RSS FEED FETCHER START ===\n')

  try {
    // Initialize small web tables
    console.log('Initializing small web tables...')
    await initializeSmallWeb()
    console.log('✓ Tables initialized\n')

    // Add default feed sources if none exist
    const existingSources = await getFeedSources()
    if (existingSources.length === 0) {
      console.log('Adding default feed sources...')
      for (const feed of DEFAULT_FEEDS) {
        await addFeedSource(feed)
        console.log(`  ✓ Added: ${feed.title}`)
      }
      console.log()
    } else {
      console.log(`Found ${existingSources.length} existing feed sources\n`)
    }

    // Fetch all feeds
    console.log('Fetching all feeds...')
    await fetchAllFeeds()
    console.log('✓ Feed fetch complete\n')

    console.log('=== RSS FEED FETCHER END ===')
  } catch (error) {
    console.error('Feed fetcher failed:', error)
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
