import { query, withClient, hasDatabase } from './db'

/**
 * Initialize the persistent schema for search runs, results, findings, feedback, domain prefs, and bookmarks.
 * This function is safe to call when DATABASE_URL is not configured (it will no-op).
 */
export async function initializeSchema(): Promise<void> {
  if (!hasDatabase()) {
    console.info('DATABASE_URL not configured — skipping schema initialization')
    return
  }

  // Attempt to create pgcrypto extension for uuid generation, but don't fail if we cannot
  await query("CREATE EXTENSION IF NOT EXISTS pgcrypto")

  // Create tables
  await query(`
    CREATE TABLE IF NOT EXISTS search_runs (
      id UUID PRIMARY KEY,
      vertical TEXT,
      query TEXT,
      normalized_query TEXT,
      lens TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      result_count INTEGER,
      runtime_ms INTEGER,
      sources JSONB,
      operators JSONB,
      error TEXT
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS search_results (
      id UUID PRIMARY KEY,
      search_run_id UUID REFERENCES search_runs(id) ON DELETE CASCADE,
      url TEXT,
      normalized_url TEXT,
      domain TEXT,
      title TEXT,
      snippet TEXT,
      source_engine TEXT,
      rank INTEGER,
      score DOUBLE PRECISION,
      final_score DOUBLE PRECISION,
      extraction_status TEXT,
      extracted_text TEXT,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS pricing_findings (
      id UUID PRIMARY KEY,
      search_result_id UUID REFERENCES search_results(id) ON DELETE CASCADE,
      provider_name TEXT,
      service_name TEXT,
      price NUMERIC NULL,
      price_text TEXT,
      currency TEXT DEFAULT 'USD',
      location TEXT,
      phone TEXT,
      email TEXT,
      evidence_text TEXT,
      source_url TEXT,
      confidence DOUBLE PRECISION,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS result_feedback (
      id UUID PRIMARY KEY,
      result_id UUID REFERENCES search_results(id) ON DELETE CASCADE,
      feedback_type TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // Keep domain_preferences shape aligned with existing domain-memory.ts
  await query(`
    CREATE TABLE IF NOT EXISTS domain_preferences (
      user_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('raise', 'lower', 'pin', 'block')),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, domain)
    )
  `)

  // Bookmarks table (simple, additive)
  await query(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id UUID PRIMARY KEY,
      user_id TEXT DEFAULT 'default',
      url TEXT NOT NULL,
      normalized_url TEXT,
      domain TEXT,
      title TEXT,
      description TEXT,
      folder TEXT DEFAULT 'General',
      tags JSONB DEFAULT '[]'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // Indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_search_results_domain ON search_results(domain)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_search_results_normalized_url ON search_results(normalized_url)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_search_results_search_run_id ON search_results(search_run_id)`)

  await query(`CREATE INDEX IF NOT EXISTS idx_pricing_findings_provider_name ON pricing_findings(provider_name)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_pricing_findings_service_name ON pricing_findings(service_name)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_pricing_findings_source_url ON pricing_findings(source_url)`)

  await query(`CREATE INDEX IF NOT EXISTS idx_domain_preferences_user_id ON domain_preferences(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_domain_preferences_domain ON domain_preferences(domain)`)

  await query(`CREATE INDEX IF NOT EXISTS bookmarks_user_idx ON bookmarks(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS bookmarks_domain_idx ON bookmarks(domain)`)
  await query(`CREATE INDEX IF NOT EXISTS bookmarks_normalized_url_idx ON bookmarks(normalized_url)`)

  console.info('Database schema initialized (if database configured)')
}

import crypto from 'crypto'

/**
 * Helper insertion functions — fail-open when DB is not available.
 * These are minimal helpers for later wiring; they will return the generated id or null.
 */
export async function insertSearchRun(data: {
  id?: string
  vertical?: string
  query?: string
  normalized_query?: string
  lens?: string
  result_count?: number
  runtime_ms?: number
  sources?: any
  operators?: any
  error?: string | null
}) {
  if (!hasDatabase()) return null
  const id = data.id || crypto.randomUUID()
  await query(
    `INSERT INTO search_runs (id, vertical, query, normalized_query, lens, result_count, runtime_ms, sources, operators, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      data.vertical || null,
      data.query || null,
      data.normalized_query || null,
      data.lens || null,
      data.result_count ?? null,
      data.runtime_ms ?? null,
      data.sources ? JSON.stringify(data.sources) : null,
      data.operators ? JSON.stringify(data.operators) : null,
      data.error || null,
    ]
  )
  return id
}

export async function insertSearchResult(data: {
  id?: string
  search_run_id?: string
  url?: string
  normalized_url?: string
  domain?: string
  title?: string
  snippet?: string
  source_engine?: string
  rank?: number
  score?: number
  final_score?: number
  extraction_status?: string
  extracted_text?: string
  metadata?: any
}) {
  if (!hasDatabase()) return null
  const id = data.id || crypto.randomUUID()
  await query(
    `INSERT INTO search_results (id, search_run_id, url, normalized_url, domain, title, snippet, source_engine, rank, score, final_score, extraction_status, extracted_text, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      data.search_run_id || null,
      data.url || null,
      data.normalized_url || null,
      data.domain || null,
      data.title || null,
      data.snippet || null,
      data.source_engine || null,
      data.rank ?? null,
      data.score ?? null,
      data.final_score ?? null,
      data.extraction_status || null,
      data.extracted_text || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  )
  return id
}

export async function insertPricingFinding(data: {
  id?: string
  search_result_id?: string
  provider_name?: string
  service_name?: string
  price?: number | null
  price_text?: string
  currency?: string
  location?: string
  phone?: string
  email?: string
  evidence_text?: string
  source_url?: string
  confidence?: number
}) {
  if (!hasDatabase()) return null
  const id = data.id || crypto.randomUUID()
  await query(
    `INSERT INTO pricing_findings (id, search_result_id, provider_name, service_name, price, price_text, currency, location, phone, email, evidence_text, source_url, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      data.search_result_id || null,
      data.provider_name || null,
      data.service_name || null,
      data.price ?? null,
      data.price_text || null,
      data.currency || 'USD',
      data.location || null,
      data.phone || null,
      data.email || null,
      data.evidence_text || null,
      data.source_url || null,
      data.confidence ?? null,
    ]
  )
  return id
}

export async function insertResultFeedback(data: { id?: string; result_id?: string; feedback_type?: string; notes?: string }) {
  if (!hasDatabase()) return null
  const id = data.id || crypto.randomUUID()
  await query(
    `INSERT INTO result_feedback (id, result_id, feedback_type, notes) VALUES ($1,$2,$3,$4)`,
    [id, data.result_id || null, data.feedback_type || null, data.notes || null]
  )
  return id
}

export async function insertBookmark(data: { id?: string; user_id?: string; url: string; normalized_url?: string; domain?: string; title?: string; description?: string; folder?: string; tags?: any; metadata?: any }) {
  if (!hasDatabase()) return null
  const id = data.id || crypto.randomUUID()
  await query(
    `INSERT INTO bookmarks (id, user_id, url, normalized_url, domain, title, description, folder, tags, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      data.user_id || 'default',
      data.url,
      data.normalized_url || null,
      data.domain || null,
      data.title || null,
      data.description || null,
      data.folder || 'General',
      data.tags ? JSON.stringify(data.tags) : JSON.stringify([]),
      data.metadata ? JSON.stringify(data.metadata) : JSON.stringify({}),
    ]
  )
  return id
}
