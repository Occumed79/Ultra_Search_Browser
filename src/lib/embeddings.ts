// ─── EMBEDDING SERVICE (Local with @xenova/transformers) ───
// SERVER-SIDE ONLY: This module must only be imported in server-side code (API routes, server components)
// Do not import this in client components or it will bundle heavy dependencies.

// Shared embedding dimension across all embedding methods
// Matches Xenova/all-MiniLM-L6-v2 output dimension
export const EMBEDDING_DIMENSION = 384

let embeddingPipeline: any = null
let isInitializing = false

/**
 * Check whether normal search-memory embedding work is enabled. The smart
 * filter has a separate background-only path so it can use the bundled model
 * without making every initial search wait for model initialization.
 */
export function isLocalEmbeddingsEnabled(): boolean {
  return process.env.ENABLE_LOCAL_EMBEDDINGS === 'true'
}

/**
 * Initialize the embedding pipeline (lazy loading with timeout).
 * Uses a lightweight sentence transformer model.
 */
export async function initializeEmbeddings(forceLocal = false): Promise<void> {
  if (embeddingPipeline !== null) return

  if (!forceLocal && !isLocalEmbeddingsEnabled()) {
    console.log('Local embeddings disabled via ENABLE_LOCAL_EMBEDDINGS env var')
    return
  }

  if (isInitializing) {
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return
  }

  isInitializing = true

  try {
    const { pipeline } = await import('@xenova/transformers')
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Embedding model initialization timeout')), 60_000)
    )

    embeddingPipeline = await Promise.race([
      pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'),
      timeoutPromise,
    ])

    console.log('Embedding pipeline initialized with Xenova/all-MiniLM-L6-v2')
  } catch (err) {
    console.error('Failed to initialize embedding pipeline, falling back to hash-based embeddings:', err)
    embeddingPipeline = null
  } finally {
    isInitializing = false
  }
}

async function runEmbedding(text: string, forceLocal: boolean): Promise<number[]> {
  if (!forceLocal && !isLocalEmbeddingsEnabled()) {
    return generateHashEmbedding(text)
  }

  if (!embeddingPipeline) {
    await initializeEmbeddings(forceLocal)
  }

  if (!embeddingPipeline) return generateHashEmbedding(text)

  try {
    const output = await embeddingPipeline(text, {
      pooling: 'mean',
      normalize: true,
    })
    return Array.from(output.data) as number[]
  } catch (err) {
    console.error('Failed to generate embedding, using hash-based fallback:', err)
    return generateHashEmbedding(text)
  }
}

/**
 * Generate a single embedding for normal search-memory operations. This keeps
 * respecting ENABLE_LOCAL_EMBEDDINGS so the initial request path stays fast.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return runEmbedding(text, false)
}

/**
 * Generate an embedding with the bundled transformer for the asynchronous
 * smart-filter refinement pass. No external API or usage charge is involved.
 */
export async function generateLocalEmbedding(text: string): Promise<number[]> {
  return runEmbedding(text, true)
}

/**
 * Generate hash-based pseudo-embedding fallback.
 * Outputs EMBEDDING_DIMENSION (384) to match Xenova/all-MiniLM-L6-v2.
 */
function generateHashEmbedding(text: string): number[] {
  const embedding = new Float32Array(EMBEDDING_DIMENSION)
  const normalizedText = text.toLowerCase().replace(/\s+/g, ' ')

  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    let hash = 0
    for (let j = 0; j < normalizedText.length; j++) {
      const char = normalizedText.charCodeAt(j)
      hash = ((hash << 5) - hash) + char + (i * char)
      hash = hash & hash
    }
    embedding[i] = (hash % 1000) / 1000
  }

  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
  if (magnitude > 0) {
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      embedding[i] /= magnitude
    }
  }

  return Array.from(embedding)
}

/**
 * Generate embeddings for multiple texts using the normal configured path.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = []
  for (const text of texts) {
    embeddings.push(await generateEmbedding(text))
  }
  return embeddings
}

/** Calculate cosine similarity between two embeddings. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Embeddings must have the same length')

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  magnitudeA = Math.sqrt(magnitudeA)
  magnitudeB = Math.sqrt(magnitudeB)
  if (magnitudeA === 0 || magnitudeB === 0) return 0
  return dotProduct / (magnitudeA * magnitudeB)
}

/** Check whether the transformer pipeline has been initialized. */
export function isEmbeddingsReady(): boolean {
  return embeddingPipeline !== null
}
