#!/usr/bin/env tsx
// Run with DATABASE_URL set (Neon):
//   DATABASE_URL=... npx tsx scripts/fetch-feeds.ts

import { bootstrapProcurementIndex } from '../src/lib/small-web'

async function main() {
  console.log('=== PROCUREMENT INDEX BOOTSTRAP ===\n')

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (Neon connection string).')
    process.exit(1)
  }

  try {
    const result = await bootstrapProcurementIndex()
    console.log(`Seeded RSS sources: ${result.seeded}`)
    console.log(`Feeds attempted:    ${result.fetch.feeds}`)
    console.log(`Entries stored:     ${result.fetch.entries}`)
    if (result.fetch.failures.length) {
      console.log('\nFailures:')
      for (const f of result.fetch.failures) console.log(`  - ${f}`)
    }
    console.log('\nIndex stats:', result.stats)
    console.log('\n=== DONE ===')
  } catch (error) {
    console.error('Bootstrap failed:', error)
    process.exit(1)
  }
}

main()
