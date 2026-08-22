import { indexVerifiedResultsInAlgolia, type AlgoliaIndexResponse } from './algolia'
import { generateEmbedding } from './embeddings'
import { createVectorStoreAdapter, type SearchDocument, type VectorStoreAdapter } from './vector-store'
import type { ScrapedResult, SearchLens } from '../types/search'

const DEFAULT_INDEX_LIMIT = 12
const DEFAULT_INDEX_TIMEOUT_MS = 4_000
const ALGOLIA_INDEX_TIMEOUT_MS = 2_500
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
      const initializable = adapter as VectorStoreAdapter & { initialize?: () => Promise<void> }
      if (typeof initializable.initialize === 'function') {
        await initializable.initialize()
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
  const evidence = result.pageValidation?.evidence.join('\n') || ''
  return [result.title, result.description, evidence, intelligence].filter(Boolean).join('\n').slice(0, 40_000)
}

export function isVerifiedMemoryCandidate(result: ScrapedResult): boolean {
  const lifecycle = result.pageValidation?.lifecycle.status
  return Boolean(
    result.url
    && result.title
    && result.bucket === 'valid'
    && result.validation?.status === 'valid'
    && result.pageValidation?.availability === 'reachable'
    && lifecycle
    && ['open', 'active', 'current', 'unknown'].includes(lifecycle)
  )
}

export interface MemoryIndexingDiagnostics {
  enabled: boolean
  attempted: number
  indexed: number
  rejectedUnverified?: number
  error?: string
  algolia?: AlgoliaIndexResponse
}

export async function indexResultsInPersistentMemory(
  results: ScrapedResult[],
  lens: SearchLens,
  limit = DEFAULT_INDEX_LIMIT,
  timeoutMs = DEFAULT_INDEX_TIMEOUT_MS
): Promise<MemoryIndexingDiagnostics> {
  const candidates = results
    .filter(isVerifiedMemoryCandidate)
    .slice(0, Math.max(0, limit))
  const rejectedUnverified = Math.max(0, results.length - candidates.length)
  const algoliaPromise = indexVerifiedResultsInAlgolia(
    candidates,
    lens,
    Math.min(30, Math.max(0, limit)),
    Math.min(ALGOLIA_INDEX_TIMEOUT_MS, timeoutMs)
  )

  if (!process.env.DATABASE_URL) {
    return {
      enabled: false,
      attempted: candidates.length,
      indexed: 0,
      rejectedUnverified,
      algolia: await algoliaPromise,
    }
  }
  if (candidates.length === 0) {
    return {
      enabled: true,
      attempted: 0,
      indexed: 0,
      rejectedUnverified,
      algolia: await algoliaPromise,
    }
  }

  const adapter = await getAdapter()
  if (!adapter) {
    return {
      enabled: false,
      attempted: candidates.length,
      indexed: 0,
      rejectedUnverified,
      error: 'pgvector adapter unavailable',
      algolia: await algoliaPromise,
    }
  }

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
            verificationStatus: 'valid',
            verifiedAt: result.pageValidation?.checkedAt,
            lifecycleStatus: result.pageValidation?.lifecycle.status,
            contentHash: result.pageValidation?.contentHash,
          },
        }
        return document
      })),
      timeoutMs,
      'persistent memory embedding generation'
    )

    await withTimeout(adapter.addDocuments(documents), timeoutMs, 'persistent memory indexing')
    return {
      enabled: true,
      attempted: candidates.length,
      indexed: documents.length,
      rejectedUnverified,
      algolia: await algoliaPromise,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Persistent memory indexing failed:', error)
    return {
      enabled: true,
      attempted: candidates.length,
      indexed: 0,
      rejectedUnverified,
      error: message,
      algolia: await algoliaPromise,
    }
  }
}
