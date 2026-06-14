// ─── VECTOR STORE INTERFACE ───

import { EMBEDDING_DIMENSION } from './embeddings'

export interface SearchDocument {
  id: string
  text: string
  embedding?: number[]
  metadata: {
    url?: string
    title?: string
    source?: string
    lens?: string
    [key: string]: any
  }
}

export interface VectorStoreAdapter {
  addDocument(document: SearchDocument): Promise<void>
  addDocuments(documents: SearchDocument[]): Promise<void>
  search(query: string, topK?: number): Promise<SearchDocument[]>
  searchByVector(vector: number[], topK?: number): Promise<SearchDocument[]>
  deleteDocument(id: string): Promise<void>
  clear(): Promise<void>
}

// ─── LOCAL VECTOR STORE ADAPTER (In-Memory) ───

export class LocalVectorStoreAdapter implements VectorStoreAdapter {
  private documents: Map<string, SearchDocument>
  private embeddings: Map<string, number[]>
  
  constructor() {
    this.documents = new Map()
    this.embeddings = new Map()
  }
  
  async addDocument(document: SearchDocument): Promise<void> {
    this.documents.set(document.id, document)
    if (document.embedding) {
      this.embeddings.set(document.id, document.embedding)
    }
  }
  
  async addDocuments(documents: SearchDocument[]): Promise<void> {
    for (const doc of documents) {
      await this.addDocument(doc)
    }
  }
  
  async search(query: string, topK = 10): Promise<SearchDocument[]> {
    // Simple text-based search for local adapter
    const queryTerms = query.toLowerCase().split(/\s+/)
    const scored: { doc: SearchDocument; score: number }[] = []
    
    this.documents.forEach((doc) => {
      const text = doc.text.toLowerCase()
      let score = 0
      
      queryTerms.forEach(term => {
        const regex = new RegExp(term, 'gi')
        const matches = text.match(regex)
        if (matches) {
          score += matches.length
        }
      })
      
      if (score > 0) {
        scored.push({ doc, score })
      }
    })
    
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.doc)
  }
  
  async searchByVector(vector: number[], topK = 10): Promise<SearchDocument[]> {
    const scored: { doc: SearchDocument; similarity: number }[] = []
    
    this.documents.forEach((doc) => {
      const docEmbedding = this.embeddings.get(doc.id)
      if (docEmbedding) {
        const similarity = this.cosineSimilarity(vector, docEmbedding)
        scored.push({ doc, similarity })
      }
    })
    
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map(s => s.doc)
  }
  
  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id)
    this.embeddings.delete(id)
  }
  
  async clear(): Promise<void> {
    this.documents.clear()
    this.embeddings.clear()
  }
  
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0
    
    let dotProduct = 0
    let magnitude1 = 0
    let magnitude2 = 0
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i]
      magnitude1 += vec1[i] * vec1[i]
      magnitude2 += vec2[i] * vec2[i]
    }
    
    magnitude1 = Math.sqrt(magnitude1)
    magnitude2 = Math.sqrt(magnitude2)
    
    if (magnitude1 === 0 || magnitude2 === 0) return 0
    
    return dotProduct / (magnitude1 * magnitude2)
  }
}

// ─── PGVECTOR STORE ADAPTER ───
// SERVER-SIDE ONLY: This module must only be imported in server-side code (API routes, server components)
// Do not import this in client components or it will bundle heavy dependencies.

import { Pool, PoolClient } from 'pg'

export class PgVectorStoreAdapter implements VectorStoreAdapter {
  private pool: Pool
  private tableName: string
  
  constructor(connectionString: string, tableName = 'documents') {
    this.pool = new Pool({ connectionString })
    this.tableName = tableName
  }
  
  async initialize(): Promise<void> {
    const client = await this.pool.connect()
    try {
      // Create pgvector extension
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')
      
      // Create documents table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
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
      
      // Create index for vector similarity search
      await client.query(`
        CREATE INDEX IF NOT EXISTS ${this.tableName}_embedding_idx 
        ON ${this.tableName} 
        USING ivfflat (embedding vector_cosine_ops)
      `)
    } finally {
      client.release()
    }
  }
  
  async addDocument(document: SearchDocument): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(
        `INSERT INTO ${this.tableName} (id, text, embedding, url, title, source, lens, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           text = EXCLUDED.text,
           embedding = EXCLUDED.embedding,
           url = EXCLUDED.url,
           title = EXCLUDED.title,
           source = EXCLUDED.source,
           lens = EXCLUDED.lens,
           metadata = EXCLUDED.metadata`,
        [
          document.id,
          document.text,
          document.embedding ? `[${document.embedding.join(',')}]` : null,
          document.metadata.url || null,
          document.metadata.title || null,
          document.metadata.source || null,
          document.metadata.lens || null,
          JSON.stringify(document.metadata),
        ]
      )
    } finally {
      client.release()
    }
  }
  
  async addDocuments(documents: SearchDocument[]): Promise<void> {
    for (const doc of documents) {
      await this.addDocument(doc)
    }
  }
  
  async search(query: string, topK = 10): Promise<SearchDocument[]> {
    // For text search, use full-text search
    const client = await this.pool.connect()
    try {
      const result = await client.query(
        `SELECT id, text, embedding, url, title, source, lens, metadata
         FROM ${this.tableName}
         WHERE text ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [`%${query}%`, topK]
      )
      
      return result.rows.map((row: any) => ({
        id: row.id,
        text: row.text,
        embedding: row.embedding ? row.embedding.slice(1, -1).split(',').map(Number) : undefined,
        metadata: {
          url: row.url,
          title: row.title,
          source: row.source,
          lens: row.lens,
          ...row.metadata,
        },
      }))
    } finally {
      client.release()
    }
  }
  
  async searchByVector(vector: number[], topK = 10): Promise<SearchDocument[]> {
    if (!vector || vector.length === 0) {
      return []
    }
    
    const client = await this.pool.connect()
    try {
      const result = await client.query(
        `SELECT id, text, embedding, url, title, source, lens, metadata,
                1 - (embedding <=> $1) as similarity
         FROM ${this.tableName}
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1
         LIMIT $2`,
        [`[${vector.join(',')}]`, topK]
      )
      
      return result.rows.map((row: any) => ({
        id: row.id,
        text: row.text,
        embedding: row.embedding ? row.embedding.slice(1, -1).split(',').map(Number) : undefined,
        metadata: {
          url: row.url,
          title: row.title,
          source: row.source,
          lens: row.lens,
          ...row.metadata,
        },
      }))
    } finally {
      client.release()
    }
  }
  
  async deleteDocument(id: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id])
    } finally {
      client.release()
    }
  }
  
  async clear(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(`DELETE FROM ${this.tableName}`)
    } finally {
      client.release()
    }
  }
  
  async close(): Promise<void> {
    await this.pool.end()
  }
}

// ─── VECTOR STORE FACTORY ───

export function createVectorStoreAdapter(type: 'local' | 'pgvector', connectionString?: string): VectorStoreAdapter {
  switch (type) {
    case 'local':
      return new LocalVectorStoreAdapter()
    case 'pgvector':
      if (!connectionString) {
        throw new Error('PgVector requires DATABASE_URL connection string')
      }
      return new PgVectorStoreAdapter(connectionString)
    default:
      throw new Error(`Unknown vector store type: ${type}`)
  }
}
