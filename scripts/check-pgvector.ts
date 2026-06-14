#!/usr/bin/env tsx
// ─── PGVECTOR CHECK SCRIPT ───
// Verifies pgvector extension, documents table, and vector operations

import pg from 'pg'

const { Client } = pg

async function checkPgvector(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.log('❌ DATABASE_URL environment variable not set')
    console.log('Set DATABASE_URL to run pgvector checks')
    process.exit(1)
  }

  console.log('=== PGVECTOR CHECK START ===\n')

  const client = new Client({ connectionString: databaseUrl })

  try {
    console.log('Connecting to database...')
    await client.connect()
    console.log('✓ Connected to database\n')

    // Check pgvector extension
    console.log('Checking pgvector extension...')
    const extResult = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      )
    `)
    const hasExtension = extResult.rows[0].exists
    if (hasExtension) {
      console.log('✓ pgvector extension is installed\n')
    } else {
      console.log('❌ pgvector extension is not installed')
      console.log('Run: CREATE EXTENSION vector;\n')
      process.exit(1)
    }

    // Check documents table
    console.log('Checking documents table...')
    const tableResult = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'documents'
      )
    `)
    const hasTable = tableResult.rows[0].exists
    if (hasTable) {
      console.log('✓ documents table exists\n')
    } else {
      console.log('Creating documents table...')
      await client.query(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          embedding vector(1536),
          metadata JSONB,
          url TEXT,
          title TEXT,
          source TEXT,
          lens TEXT,
          rank INTEGER
        )
      `)
      console.log('✓ documents table created\n')
    }

    // Check embedding column
    console.log('Checking embedding column...')
    const columnResult = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'embedding'
      )
    `)
    const hasColumn = columnResult.rows[0].exists
    if (hasColumn) {
      console.log('✓ embedding column exists\n')
    } else {
      console.log('Adding embedding column...')
      await client.query('ALTER TABLE documents ADD COLUMN embedding vector(1536)')
      console.log('✓ embedding column added\n')
    }

    // Insert test vector
    console.log('Inserting test vector...')
    const testId = 'test-vector-' + Date.now()
    const testVector = Array.from({ length: 1536 }, () => Math.random())
    await client.query(
      'INSERT INTO documents (id, text, embedding) VALUES ($1, $2, $3)',
      [testId, 'Test document for pgvector verification', testVector]
    )
    console.log('✓ Test vector inserted\n')

    // Query test vector back
    console.log('Querying test vector back...')
    const queryResult = await client.query(
      'SELECT id, text, embedding FROM documents WHERE id = $1',
      [testId]
    )
    if (queryResult.rows.length === 1) {
      console.log('✓ Test vector retrieved successfully\n')
    } else {
      console.log('❌ Failed to retrieve test vector\n')
      process.exit(1)
    }

    // Test similarity search
    console.log('Testing similarity search...')
    const similarityResult = await client.query(
      `
      SELECT id, text, 1 - (embedding <=> $1) as similarity
      FROM documents
      WHERE id = $2
      `,
      [testVector, testId]
    )
    if (similarityResult.rows.length === 1) {
      const similarity = similarityResult.rows[0].similarity
      console.log(`✓ Similarity search works (similarity: ${similarity.toFixed(4)})\n`)
    } else {
      console.log('❌ Similarity search failed\n')
      process.exit(1)
    }

    // Delete test row
    console.log('Cleaning up test row...')
    await client.query('DELETE FROM documents WHERE id = $1', [testId])
    console.log('✓ Test row deleted\n')

    console.log('=== PGVECTOR CHECK PASSED ===')
    console.log('All checks completed successfully!')
  } catch (err) {
    console.error('❌ PGVECTOR CHECK FAILED:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

checkPgvector().catch(e => {
  console.error('Check failed:', e)
  process.exit(1)
})
