// ─── SEMANTIC RETRIEVAL WITH EMBEDDINGS + HYBRID SEARCH ───

export interface DocumentVector {
  id: string
  text: string
  embedding: number[]
  metadata: {
    url?: string
    title?: string
    source?: string
    lens?: string
  }
}

export interface SearchResult {
  document: DocumentVector
  score: number
  bm25Score: number
  vectorScore: number
}

// ─── SIMPLE EMBEDDING GENERATION (TF-IDF based for now - can be upgraded to actual embeddings) ───

/**
 * Generate a simple text embedding using TF-IDF-like approach
 * In production, this would use OpenAI embeddings, Cohere, or a local model
 */
export function generateEmbedding(text: string): number[] {
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []
  const wordFreq: Record<string, number> = {}
  
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1
  })
  
  // Create a fixed-size embedding based on word frequencies
  const embedding = new Array(128).fill(0)
  const uniqueWords = Object.keys(wordFreq)
  
  uniqueWords.forEach((word, i) => {
    const hash = simpleHash(word)
    const index = hash % 128
    embedding[index] = Math.min(1, wordFreq[word] / words.length)
  })
  
  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
  if (magnitude > 0) {
    return embedding.map(val => val / magnitude)
  }
  
  return embedding
}

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

// ─── BM25 SCORING ───

export interface BM25Params {
  k1: number
  b: number
}

const DEFAULT_BM25_PARAMS: BM25Params = { k1: 1.2, b: 0.75 }

export class BM25Index {
  private documents: Map<string, { text: string; termFreqs: Map<string, number>; docLength: number }>
  private docFreqs: Map<string, number>
  private avgDocLength: number
  private totalDocs: number
  
  constructor() {
    this.documents = new Map()
    this.docFreqs = new Map()
    this.avgDocLength = 0
    this.totalDocs = 0
  }
  
  addDocument(id: string, text: string): void {
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []
    const termFreqs = new Map<string, number>()
    
    words.forEach(word => {
      termFreqs.set(word, (termFreqs.get(word) || 0) + 1)
    })
    
    this.documents.set(id, {
      text,
      termFreqs,
      docLength: words.length,
    })
    
    // Update document frequencies
    const uniqueWords = new Set(words)
    uniqueWords.forEach(word => {
      this.docFreqs.set(word, (this.docFreqs.get(word) || 0) + 1)
    })
    
    // Update average document length
    this.totalDocs++
    const totalLength = Array.from(this.documents.values()).reduce((sum, doc) => sum + doc.docLength, 0)
    this.avgDocLength = totalLength / this.totalDocs
  }
  
  score(query: string, params: BM25Params = DEFAULT_BM25_PARAMS): Map<string, number> {
    const queryWords = query.toLowerCase().match(/\b[a-z]{3,}\b/g) || []
    const scores = new Map<string, number>()
    
    this.documents.forEach((doc, id) => {
      let score = 0
      
      queryWords.forEach(word => {
        const termFreq = doc.termFreqs.get(word) || 0
        const docFreq = this.docFreqs.get(word) || 0
        
        if (termFreq > 0) {
          const idf = Math.log((this.totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1)
          const tf = (termFreq * (params.k1 + 1)) / (termFreq + params.k1 * (1 - params.b + params.b * (doc.docLength / this.avgDocLength)))
          score += idf * tf
        }
      })
      
      scores.set(id, score)
    })
    
    return scores
  }
}

// ─── VECTOR SIMILARITY ───

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
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

// ─── HYBRID SEARCH (BM25 + VECTORS) ───

export class HybridSearchIndex {
  private bm25Index: BM25Index
  private vectors: Map<string, DocumentVector>
  private alpha: number // Weight for BM25 (0-1)
  
  constructor(alpha = 0.5) {
    this.bm25Index = new BM25Index()
    this.vectors = new Map()
    this.alpha = alpha
  }
  
  addDocument(document: DocumentVector): void {
    this.bm25Index.addDocument(document.id, document.text)
    this.vectors.set(document.id, document)
  }
  
  search(
    query: string,
    topK = 10,
    bm25Params?: BM25Params
  ): SearchResult[] {
    // BM25 scores
    const bm25Scores = this.bm25Index.score(query, bm25Params)
    
    // Vector scores
    const queryEmbedding = generateEmbedding(query)
    const vectorScores = new Map<string, number>()
    
    this.vectors.forEach((doc, id) => {
      const similarity = cosineSimilarity(queryEmbedding, doc.embedding)
      vectorScores.set(id, similarity)
    })
    
    // Normalize scores
    const maxBM25 = Math.max(...Array.from(bm25Scores.values()), 1)
    const maxVector = Math.max(...Array.from(vectorScores.values()), 1)
    
    // Combine scores
    const results: SearchResult[] = []
    
    this.vectors.forEach((doc, id) => {
      const bm25Score = (bm25Scores.get(id) || 0) / maxBM25
      const vectorScore = (vectorScores.get(id) || 0) / maxVector
      const combinedScore = this.alpha * bm25Score + (1 - this.alpha) * vectorScore
      
      results.push({
        document: doc,
        score: combinedScore,
        bm25Score,
        vectorScore,
      })
    })
    
    // Sort by combined score and return top K
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
  
  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha))
  }
}

// ─── SEMANTIC SEARCH INTEGRATION ───

export async function semanticSearch(
  query: string,
  documents: { id: string; text: string; url?: string; title?: string; source?: string; lens?: string }[],
  topK = 10,
  alpha = 0.5
): Promise<SearchResult[]> {
  const index = new HybridSearchIndex(alpha)
  
  // Add documents to index
  for (const doc of documents) {
    const embedding = generateEmbedding(doc.text)
    index.addDocument({
      id: doc.id,
      text: doc.text,
      embedding,
      metadata: {
        url: doc.url,
        title: doc.title,
        source: doc.source,
        lens: doc.lens,
      },
    })
  }
  
  // Perform search
  return index.search(query, topK)
}

/**
 * Re-rank existing search results using semantic similarity
 */
export function rerankResults(
  query: string,
  results: { id: string; text: string; url?: string; title?: string; source?: string }[],
  topK = 10
): { id: string; score: number; originalIndex: number }[] {
  const queryEmbedding = generateEmbedding(query)
  const scores: { id: string; score: number; originalIndex: number }[] = []
  
  results.forEach((result, index) => {
    const docEmbedding = generateEmbedding(result.text)
    const similarity = cosineSimilarity(queryEmbedding, docEmbedding)
    scores.push({
      id: result.id,
      score: similarity,
      originalIndex: index,
    })
  })
  
  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
