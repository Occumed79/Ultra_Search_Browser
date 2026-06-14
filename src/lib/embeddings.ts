// ─── EMBEDDING SERVICE (Local with @xenova/transformers) ───
// SERVER-SIDE ONLY: This module must only be imported in server-side code (API routes, server components)
// Do not import this in client components or it will bundle heavy dependencies.

// Shared embedding dimension across all embedding methods
// Matches Xenova/all-MiniLM-L6-v2 output dimension
export const EMBEDDING_DIMENSION = 384

let embeddingPipeline: any = null
let isInitializing = false

/**
 * Check if local embeddings are enabled via environment variable
 */
export function isLocalEmbeddingsEnabled(): boolean {
  return process.env.ENABLE_LOCAL_EMBEDDINGS === 'true'
}

/**
 * Initialize the embedding pipeline (lazy loading with timeout)
 * Uses a lightweight sentence transformer model
 */
export async function initializeEmbeddings(): Promise<void> {
  if (embeddingPipeline !== null) {
    return
  }
  
  if (!isLocalEmbeddingsEnabled()) {
    console.log('Local embeddings disabled via ENABLE_LOCAL_EMBEDDINGS env var')
    return
  }
  
  if (isInitializing) {
    // Wait for existing initialization
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return
  }
  
  isInitializing = true
  
  try {
    // Dynamic import to avoid bundling heavy dependencies
    const { pipeline } = await import('@xenova/transformers')
    
    // Add timeout for model loading (60 seconds)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Embedding model initialization timeout')), 60000)
    )
    
    // Use a lightweight sentence transformer model
    // 'Xenova/all-MiniLM-L6-v2' is a good balance of speed and quality
    embeddingPipeline = await Promise.race([
      pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'),
      timeoutPromise,
    ])
    
    console.log('Embedding pipeline initialized with Xenova/all-MiniLM-L6-v2')
  } catch (err) {
    console.error('Failed to initialize embedding pipeline, falling back to hash-based embeddings:', err)
    embeddingPipeline = null
    // Don't throw - allow fallback to hash-based embeddings
  } finally {
    isInitializing = false
  }
}

/**
 * Generate embedding for a single text
 * Falls back to hash-based pseudo-embedding if model fails
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Check if local embeddings are enabled
  if (!isLocalEmbeddingsEnabled()) {
    console.log('Local embeddings disabled, using hash-based fallback')
    return generateHashEmbedding(text)
  }
  
  // Try to initialize if not already done
  if (!embeddingPipeline) {
    await initializeEmbeddings()
  }
  
  // If pipeline is still not available, use fallback
  if (!embeddingPipeline) {
    console.log('Embedding pipeline not available, using hash-based fallback')
    return generateHashEmbedding(text)
  }
  
  try {
    const output = await embeddingPipeline(text, {
      pooling: 'mean',
      normalize: true,
    })
    
    // Convert to array with proper type casting
    const embedding = Array.from(output.data) as number[]
    return embedding
  } catch (err) {
    console.error('Failed to generate embedding, using hash-based fallback:', err)
    return generateHashEmbedding(text)
  }
}

/**
 * Generate hash-based pseudo-embedding (fallback)
 * This is a lightweight alternative that doesn't require external models
 * Outputs EMBEDDING_DIMENSION (384) to match Xenova/all-MiniLM-L6-v2
 */
function generateHashEmbedding(text: string): number[] {
  const embedding = new Float32Array(EMBEDDING_DIMENSION)
  const normalizedText = text.toLowerCase().replace(/\s+/g, ' ')
  
  // Simple hash-based embedding generation
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    let hash = 0
    for (let j = 0; j < normalizedText.length; j++) {
      const char = normalizedText.charCodeAt(j)
      hash = ((hash << 5) - hash) + char + (i * char)
      hash = hash & hash // Convert to 32-bit integer
    }
    embedding[i] = (hash % 1000) / 1000 // Normalize to [-1, 1]
  }
  
  // Normalize the vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
  if (magnitude > 0) {
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      embedding[i] /= magnitude
    }
  }
  
  return Array.from(embedding)
}

/**
 * Generate embeddings for multiple texts (batch processing)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = []
  
  for (const text of texts) {
    const embedding = await generateEmbedding(text)
    embeddings.push(embedding)
  }
  
  return embeddings
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same length')
  }
  
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
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0
  }
  
  return dotProduct / (magnitudeA * magnitudeB)
}

/**
 * Check if embeddings are available
 */
export function isEmbeddingsReady(): boolean {
  return embeddingPipeline !== null
}
