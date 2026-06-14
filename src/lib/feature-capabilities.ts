// ─── FEATURE CAPABILITY STATUS METADATA ───

export type FeatureStatus = 'active' | 'experimental' | 'scaffold' | 'planned' | 'blocked'

export interface FeatureCapability {
  id: string
  label: string
  description: string
  status: FeatureStatus
  runtimeEnabled: boolean
  notes: string
}

export const FEATURE_CAPABILITIES: FeatureCapability[] = [
  {
    id: 'local_bm25_reranking',
    label: 'Local BM25 Reranking',
    description: 'BM25-style term frequency scoring for result relevance',
    status: 'active',
    runtimeEnabled: true,
    notes: 'In-memory BM25 implementation with configurable k1 and b parameters',
  },
  {
    id: 'local_pseudo_vector_reranking',
    label: 'Local Pseudo-Vector Reranking',
    description: 'Hash-based TF-IDF vector approximation for semantic similarity',
    status: 'experimental',
    runtimeEnabled: true,
    notes: 'In-memory cosine similarity on 384-dim hash-based embeddings. Not production-grade embeddings.',
  },
  {
    id: 'pgvector_retrieval',
    label: 'pgvector Retrieval',
    description: 'PostgreSQL pgvector extension for persistent vector storage and similarity search',
    status: 'active',
    runtimeEnabled: true,
    notes: 'Active when DATABASE_URL is configured. Requires PostgreSQL with pgvector extension. Automatic schema initialization on first use. Uses 384-dim hash-based embeddings by default.',
  },
  {
    id: 'embedding_model',
    label: 'Local Embedding Model',
    description: 'Local sentence transformer model for generating text embeddings',
    status: 'experimental',
    runtimeEnabled: false,
    notes: 'Implemented with @xenova/transformers using Xenova/all-MiniLM-L6-v2 model. Requires ENABLE_LOCAL_EMBEDDINGS=true env var. Falls back to hash-based embeddings if disabled or fails. Has 60s initialization timeout.',
  },
  {
    id: 'document_text_extraction',
    label: 'Document Text Extraction',
    description: 'HTML, PDF, DOCX, and image text extraction with entity recognition',
    status: 'active',
    runtimeEnabled: true,
    notes: 'HTML extraction with cheerio, PDF binary parsing with pdf-parse, DOCX with mammoth, OCR with Tesseract.js.',
  },
  {
    id: 'pdf_binary_parsing',
    label: 'PDF Binary Parsing',
    description: 'Direct binary PDF file parsing using pdf-parse',
    status: 'active',
    runtimeEnabled: true,
    notes: 'Implemented with pdf-parse library. Extracts text, metadata, and page count from binary PDF files.',
  },
  {
    id: 'docx_binary_parsing',
    label: 'DOCX Binary Parsing',
    description: 'Direct binary DOCX file parsing using mammoth',
    status: 'active',
    runtimeEnabled: true,
    notes: 'Implemented with mammoth library. Extracts text from DOCX files.',
  },
  {
    id: 'ocr',
    label: 'OCR (Optical Character Recognition)',
    description: 'Text extraction from scanned documents and images',
    status: 'experimental',
    runtimeEnabled: false,
    notes: 'Implemented with Tesseract.js. Requires ENABLE_OCR=true env var. Disabled by default due to performance impact. Has 30s timeout per operation.',
  },
  {
    id: 'procurement_search',
    label: 'Procurement Search',
    description: 'Web search with procurement-focused query expansion and ranking',
    status: 'active',
    runtimeEnabled: true,
    notes: 'Uses web search with RFP, RFQ, bid, solicitation, site:.gov, site:.us, PDF expansions. Includes ranking boosts for .gov domains and procurement terms.',
  },
  {
    id: 'procurement_pdf_extraction',
    label: 'Procurement PDF Extraction',
    description: 'Automatic PDF extraction for procurement documents',
    status: 'active',
    runtimeEnabled: true,
    notes: 'Extracts text from PDF URLs found in procurement searches. Supports .gov and .us domains with automatic extraction.',
  },
  {
    id: 'government_pdf_ranking',
    label: 'Government/PDF Ranking Boosts',
    description: 'Ranking boosts for government domains and PDF documents',
    status: 'active',
    runtimeEnabled: true,
    notes: 'Boosts .gov domains by +50, .us domains by +30, PDF files by +40, procurement terms by +25. Penalizes junk directories.',
  },
]

export function getFeatureCapability(id: string): FeatureCapability | undefined {
  return FEATURE_CAPABILITIES.find(cap => cap.id === id)
}

export function getFeaturesByStatus(status: FeatureStatus): FeatureCapability[] {
  return FEATURE_CAPABILITIES.filter(cap => cap.status === status)
}

export function getRuntimeEnabledFeatures(): FeatureCapability[] {
  return FEATURE_CAPABILITIES.filter(cap => cap.runtimeEnabled)
}
