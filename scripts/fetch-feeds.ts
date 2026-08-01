#!/usr/bin/env tsx
// ─── BACKGROUND JOB TO FETCH RSS FEEDS ───
// Run periodically (cron / Render cron) to keep the local procurement index fresh.
// Requires DATABASE_URL.

import {
  initializeSmallWeb,
  addFeedSource,
  fetchAllFeeds,
  getFeedSources,
} from '../src/lib/small-web'
import {
  getActiveRssSeeds,
  rssSeedToFeedSource,
  ALL_PROCUREMENT_INDEX_SEEDS,
} from '../src/lib/procurement-index-seeds'

async function main() {
  console.log('=== PROCUREMENT INDEX FEED FETCHER ===\n')

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Set it, then re-run this script.')
    process.exit(1)
  }

  try {
    console.log('Initializing small-web / index tables...')
    await initializeSmallWeb()
    console.log('✓ Tables ready\n')

    const rssSeeds = getActiveRssSeeds()
    console.log(`Seeding ${rssSeeds.length} active RSS sources from procurement-index-seeds...`)
    for (const seed of rssSeeds) {
      await addFeedSource(rssSeedToFeedSource(seed))
      console.log(`  ✓ ${seed.title}`)
      console.log(`      ${seed.url}`)
    }
    console.log()

    const portalCount = ALL_PROCUREMENT_INDEX_SEEDS.filter(s => s.kind === 'portal' || s.kind === 'api').length
    console.log(
      `Note: ${portalCount} portal/API seeds are catalogued in src/lib/procurement-index-seeds.ts`
    )
    console.log('      but are not fetched as RSS yet (list-page indexer is a later step).\n')

    const sources = await getFeedSources()
    console.log(`Active feed_sources in DB: ${sources.length}`)
    for (const s of sources) {
      console.log(`  - [${s.category}] ${s.title}`)
    }
    console.log()

    console.log('Fetching all active feeds...')
    await fetchAllFeeds()
    console.log('✓ Feed fetch complete\n')

    console.log('=== DONE ===')
  } catch (error) {
    console.error('Feed fetcher failed:', error)
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
