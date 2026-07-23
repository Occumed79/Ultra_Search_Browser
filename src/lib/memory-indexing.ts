import { generateEmbedding } from './embeddings'
import { createVectorStoreAdapter, type SearchDocument, type VectorStoreAdapter } from './vector-store'
import type { ScrapedResult, SearchLens } from '../types/search'

const DEFAULT_INDEX_LIMIT = 12
const DEFAULT_INDEX_TIMEOUT_MS = 4_000
let adapterPromise: Promise<VectorStoreAdapter | null> | null = null

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function getAdapter(): Promise<VectorStoreAdapter | null> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null
  if (adapterPromise) return adapterPromise

  adapterPromise = (async () => {
    try {
      const adapter = createVectorStoreAdapter('pgvector', databaseUrl)
      if ('initialize' in adapter && typeof adapter.initialize === 'function') {
        await adapter.initialize()
      }
      return adapter
    } catch (error) {
      console.warn('Persistent memory adapter initialization failed:', error)
      return null
    }
  })()

  return adapterPromise
}

function documentText(result: ScrapedResult): string {
  const intelligence = result.intelligence ? JSON.stringify(result.intelligence) : ''
  return [result.title, result.description, intelligence].filter(Boolean).join('\n').slice(0, 40_000)
}

export interface MemoryIndexingDiagnostics {
  enabled: boolean
  attempted: number
  indexed: number
  error?: string
}

export async function indexResultsInPersistentMemory(
  results: ScrapedResult[],
  lens: SearchLens,
  limit = DEFAULT_INDEX_LIMIT,
  timeoutMs = DEFAULT_INDEX_TIMEOUT_MS
): Promise<MemoryIndexingDiagnostics> {
  if (!process.env.DATABASE_URL) return { enabled: false, attempted: 0, indexed: 0 }

  const adapter = await getAdapter()
  if (!adapter) return { enabled: false, attempted: 0, indexed: 0, error: 'pgvector adapter unavailable' }

  const candidates = results
    .filter(result => Boolean(result.url && result.title))
    .slice(0, Math.max(0, limit))

  try {
    const documents = await withTimeout(
      Promise.all(candidates.map(async result => {
        const text = documentText(result)
        const embedding = await generateEmbedding(text)
        const document: SearchDocument = {
          id: result.url,
          text,
          embedding,
          metadata: {
            url: result.url,
            title: result.title,
            source: result.source,
            lens,
            rank: result.rank,
            score: result.score,
          },
        }
        return document
      })),
      timeoutMs,
      'persistent memory embedding generation'
    )

    await withTimeout(adapter.addDocuments(documents), timeoutMs, 'persistent memory indexing')
    return { enabled: true, attempted: candidates.length, indexed: documents.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Persistent memory indexing failed:', error)
    return { enabled: true, attempted: candidates.length, indexed: 0, error: message }
  }
}
