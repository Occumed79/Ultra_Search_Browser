#!/usr/bin/env tsx
// ─── MIGRATE PGVECTOR TABLE TO NEW SCHEMA ───
// Drops and recreates the documents table with correct schema

import pg from 'pg'
import { EMBEDDING_DIMENSION } from '../src/lib/embeddings'

const { Client } = pg

async function migratePgvector(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const client = new Client({ connectionString })
  
  try {
    console.log('=== PGVECTOR MIGRATION START ===\n')
    console.log('Connecting to database...')
    await client.connect()
    console.log('✓ Connected to database\n')

    console.log('Dropping existing documents table...')
    await client.query('DROP TABLE IF EXISTS documents')
    console.log('✓ Dropped existing table\n')

    console.log('Creating new documents table with correct schema...')
    await client.query(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        embedding vector(${EMBEDDING_DIMENSION}),
        url TEXT,
        title TEXT,
        source TEXT,
        lens TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log('✓ Created new table\n')

    console.log('Creating vector index...')
    await client.query(`
      CREATE INDEX documents_embedding_idx 
      ON documents 
      USING ivfflat (embedding vector_cosine_ops)
    `)
    console.log('✓ Created vector index\n')

    console.log('=== PGVECTOR MIGRATION COMPLETE ===')
    console.log(`Table schema now uses ${EMBEDDING_DIMENSION}-dimension vectors`)
  } catch (error) {
    console.error('Error during migration:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

migratePgvector().catch(e => {
  console.error('Migration failed:', e)
  process.exit(1)
})
