#!/usr/bin/env tsx
// ─── SMOKE TEST FOR PGVECTOR SEARCH INTEGRATION ───
// Proves that live search indexes documents, persisted vectors can be retrieved,
// and a second live search exercises vector-backed ranking.

import pg from 'pg'
import { searchIntelligence } from '../src/lib/search'
import { generateEmbedding } from '../src/lib/embeddings'
import { PgVectorStoreAdapter } from '../src/lib/vector-store'

const { Client } = pg

function assertCheck(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function smokePgvectorSearch(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable not set')
    console.error('Set DATABASE_URL to run pgvector smoke test')
    process.exitCode = 1
    return
  }

  const client = new Client({ connectionString: databaseUrl })
  const adapter = new PgVectorStoreAdapter(databaseUrl)
  const firstQuery = 'occupational health services RFP'

  console.log('=== PGVECTOR SEARCH SMOKE TEST START ===\n')

  try {
    await client.connect()
    await adapter.initialize()

    const beforeResult = await client.query(
      'SELECT COUNT(*)::int AS count FROM documents WHERE embedding IS NOT NULL'
    )
    const beforeCount = Number(beforeResult.rows[0]?.count || 0)
    console.log(`Documents with embeddings before search: ${beforeCount}`)

    console.log(`\nRunning first live search: "${firstQuery}"`)
    const firstSearch = await searchIntelligence(firstQuery, 'procurement')

    console.log('\n=== FIRST SEARCH ===')
    console.log(`Result count: ${firstSearch.results.length}`)
    console.log(`Indexing attempted: ${firstSearch.pgvectorDiagnostics?.indexingAttempted}`)
    console.log(`Indexed count reported: ${firstSearch.pgvectorDiagnostics?.indexedCount}`)
    console.log(`Vector matches reported: ${firstSearch.pgvectorDiagnostics?.vectorMatches}`)

    firstSearch.results.slice(0, 3).forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.title}`)
      console.log(`     ${result.url}`)
    })

    assertCheck(firstSearch.results.length > 0, 'First live search returned no results')
    assertCheck(firstSearch.pgvectorDiagnostics?.enabled, 'pgvector is not enabled')
    assertCheck(firstSearch.pgvectorDiagnostics?.databaseConfigured, 'Database is not configured')
    assertCheck(firstSearch.pgvectorDiagnostics?.indexingAttempted, 'Live search did not attempt indexing')
    assertCheck(
      (firstSearch.pgvectorDiagnostics?.indexedCount || 0) > 0,
      'Live search reported zero indexed documents'
    )

    const candidateUrls = firstSearch.results
      .slice(0, 20)
      .map(result => result.url)
      .filter(Boolean)

    const persistedResult = await client.query(
      `SELECT id, text, url, title, source, lens
       FROM documents
       WHERE id = ANY($1::text[])
         AND embedding IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 20`,
      [candidateUrls]
    )

    console.log('\n=== PERSISTENCE VERIFICATION ===')
    console.log(`Live-search documents actually persisted: ${persistedResult.rows.length}`)
    assertCheck(
      persistedResult.rows.length > 0,
      'Indexing was reported, but none of the live-search documents exist in pgvector'
    )

    const knownDocument = persistedResult.rows[0]
    console.log(`Known persisted document: ${knownDocument.title || knownDocument.id}`)
    console.log(`Known persisted URL: ${knownDocument.url || knownDocument.id}`)

    // Query with the exact persisted document text. The known row should be the
    // nearest result with cosine similarity approximately 1.0.
    const knownEmbedding = await generateEmbedding(knownDocument.text)
    const directMatches = await adapter.searchByVector(knownEmbedding, 5)
    const exactMatch = directMatches.find(match => match.id === knownDocument.id)

    console.log('\n=== DIRECT VECTOR RETRIEVAL ===')
    console.log(`Vector matches after indexing: ${directMatches.length}`)
    directMatches.forEach((match, index) => {
      console.log(
        `  ${index + 1}. ${match.metadata.title || match.id} ` +
        `(similarity: ${(match.similarity ?? 0).toFixed(6)})`
      )
    })

    assertCheck(directMatches.length > 0, 'Vector retrieval returned zero rows after indexing')
    assertCheck(exactMatch, 'Known indexed document was not returned by vector retrieval')
    assertCheck(
      (exactMatch.similarity ?? 0) > 0.99,
      `Known indexed document similarity was unexpectedly low: ${exactMatch.similarity}`
    )

    // Run a second live search after the database has accumulated documents.
    // This exercises the same memory-vector and pgvector paths used by /api/search.
    const secondQuery = String(knownDocument.title || knownDocument.text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)

    assertCheck(secondQuery.length > 0, 'Could not construct second search query')
    console.log(`\nRunning second live search: "${secondQuery}"`)
    const secondSearch = await searchIntelligence(secondQuery, 'procurement')

    const memoryVectorResults = secondSearch.results.filter(
      result => result.source === 'memory-vector'
    )
    const rankingInfluenced =
      memoryVectorResults.some(result => (result.score || 0) > 0) ||
      (secondSearch.pgvectorDiagnostics?.vectorMatches || 0) > 0

    console.log('\n=== SECOND SEARCH / LIVE RANKING ===')
    console.log(`Result count: ${secondSearch.results.length}`)
    console.log(`Vector search attempted: ${secondSearch.pgvectorDiagnostics?.vectorSearchAttempted}`)
    console.log(`Vector matches: ${secondSearch.pgvectorDiagnostics?.vectorMatches}`)
    console.log(`Memory-vector results merged: ${memoryVectorResults.length}`)
    console.log(`Vector-backed ranking path exercised: ${rankingInfluenced}`)

    assertCheck(
      secondSearch.pgvectorDiagnostics?.vectorSearchAttempted,
      'Second live search did not attempt pgvector retrieval'
    )
    assertCheck(
      (secondSearch.pgvectorDiagnostics?.vectorMatches || 0) > 0,
      'Second live search returned zero pgvector matches after indexing'
    )
    assertCheck(rankingInfluenced, 'pgvector did not influence the live ranking path')

    const afterResult = await client.query(
      'SELECT COUNT(*)::int AS count FROM documents WHERE embedding IS NOT NULL'
    )
    const afterCount = Number(afterResult.rows[0]?.count || 0)

    console.log('\n=== FINAL VALIDATION ===')
    console.log(`Documents with embeddings after search: ${afterCount}`)
    console.log(`Indexed/persisted during test: ${Math.max(0, afterCount - beforeCount)}`)
    console.log(`Vector matches after indexing: ${directMatches.length}`)
    console.log('✓ Live indexing persisted real documents')
    console.log('✓ Vector retrieval returned the known indexed document')
    console.log('✓ Second live search returned pgvector matches')
    console.log('✓ pgvector participates in live result ranking')
    console.log('\n=== PGVECTOR SEARCH SMOKE TEST PASSED ===')
  } catch (error) {
    console.error('\n❌ PGVECTOR SEARCH SMOKE TEST FAILED')
    console.error(error)
    process.exitCode = 1
  } finally {
    await Promise.allSettled([
      client.end(),
      adapter.close(),
    ])
  }
}

smokePgvectorSearch().catch(error => {
  console.error('Smoke test failed:', error)
  process.exitCode = 1
})
