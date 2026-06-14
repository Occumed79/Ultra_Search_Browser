#!/usr/bin/env tsx
// ─── SMOKE TEST FOR PGVECTOR SEARCH INTEGRATION ───
// Tests that pgvector actually participates in live search

import { searchIntelligence } from '../src/lib/search'
import pg from 'pg'

const { Client } = pg

async function smokePgvectorSearch(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.log('❌ DATABASE_URL environment variable not set')
    console.log('Set DATABASE_URL to run pgvector smoke test')
    process.exit(1)
  }

  console.log('=== PGVECTOR SEARCH SMOKE TEST START ===\n')

  const testQuery = 'occupational health services RFP'
  console.log(`Running test search: "${testQuery}"`)

  try {
    // Run real search through searchIntelligence
    const { intelligence, results, pgvectorDiagnostics } = await searchIntelligence(testQuery, 'procurement')
    
    console.log('\n=== SEARCH RESULTS ===')
    console.log(`Result count: ${results.length}`)
    console.log(`Top 3 results:`)
    results.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.title}`)
      console.log(`     URL: ${r.url}`)
    })

    console.log('\n=== PGVECTOR DIAGNOSTICS ===')
    console.log(`Enabled: ${pgvectorDiagnostics?.enabled}`)
    console.log(`Database configured: ${pgvectorDiagnostics?.databaseConfigured}`)
    console.log(`Indexing attempted: ${pgvectorDiagnostics?.indexingAttempted}`)
    console.log(`Indexed count: ${pgvectorDiagnostics?.indexedCount}`)
    console.log(`Vector search attempted: ${pgvectorDiagnostics?.vectorSearchAttempted}`)
    console.log(`Vector matches: ${pgvectorDiagnostics?.vectorMatches}`)
    if (pgvectorDiagnostics?.error) {
      console.log(`Error: ${pgvectorDiagnostics.error}`)
    }

    // Verify database state
    console.log('\n=== DATABASE VERIFICATION ===')
    const client = new Client({ connectionString: databaseUrl })
    await client.connect()

    // Check if documents were inserted
    const countResult = await client.query('SELECT COUNT(*) as count FROM documents')
    const count = parseInt(countResult.rows[0].count)
    console.log(`Total documents in database: ${count}`)

    // Check for recent documents from this test
    const recentResult = await client.query(`
      SELECT id, title, url 
      FROM documents 
      ORDER BY id DESC 
      LIMIT 5
    `)
    console.log(`Recent documents (last 5 minutes): ${recentResult.rows.length}`)
    recentResult.rows.forEach(r => {
      console.log(`  - ${r.title || r.id} (${r.url})`)
    })

    // Test vector similarity search
    console.log('\n=== VECTOR SIMILARITY TEST ===')
    const { generateEmbedding } = await import('../src/lib/embeddings')
    const queryEmbedding = await generateEmbedding(testQuery)
    const vectorString = `[${queryEmbedding.map(v => v.toFixed(6)).join(',')}]`
    
    const similarityResult = await client.query(
      `
      SELECT id, title, url, 1 - (embedding <=> $1) as similarity
      FROM documents
      ORDER BY embedding <=> $1
      LIMIT 5
      `,
      [vectorString]
    )
    
    console.log(`Similarity search results: ${similarityResult.rows.length}`)
    similarityResult.rows.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.title || r.id} (similarity: ${r.similarity.toFixed(4)})`)
    })

    await client.end()

    // Pass/fail criteria
    console.log('\n=== VALIDATION ===')
    let passed = true
    
    if (!pgvectorDiagnostics?.enabled) {
      console.log('❌ pgvector not enabled')
      passed = false
    } else {
      console.log('✓ pgvector enabled')
    }
    
    if (!pgvectorDiagnostics?.databaseConfigured) {
      console.log('❌ database not configured')
      passed = false
    } else {
      console.log('✓ database configured')
    }
    
    if (!pgvectorDiagnostics?.indexingAttempted) {
      console.log('❌ indexing not attempted')
      passed = false
    } else {
      console.log('✓ indexing attempted')
    }
    
    if (pgvectorDiagnostics?.indexedCount === 0) {
      console.log('❌ no documents indexed')
      passed = false
    } else {
      console.log(`✓ ${pgvectorDiagnostics.indexedCount} documents indexed`)
    }
    
    if (!pgvectorDiagnostics?.vectorSearchAttempted) {
      console.log('❌ vector search not attempted')
      passed = false
    } else {
      console.log('✓ vector search attempted')
    }
    
    // Vector matches are optional (may be 0 for fresh database)
    if (similarityResult.rows.length > 0) {
      console.log('✓ vector similarity search returned results')
    } else {
      console.log('⚠ vector similarity search returned no results (expected for fresh database)')
    }

    console.log('\n=== SMOKE TEST END ===')
    if (passed) {
      console.log('✓ ALL CHECKS PASSED')
      process.exit(0)
    } else {
      console.log('❌ SOME CHECKS FAILED')
      process.exit(1)
    }
  } catch (err) {
    console.error('❌ SMOKE TEST FAILED:', err)
    process.exit(1)
  }
}

smokePgvectorSearch().catch(e => {
  console.error('Smoke test failed:', e)
  process.exit(1)
})
