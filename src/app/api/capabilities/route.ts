import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { semanticIntentCapabilities } from '../../../lib/semantic-intent'

export async function GET() {
  const providers = externalSmartFilterCapabilities()
  const gemini = semanticIntentCapabilities()
  const cloudflare = cloudflareRerankCapabilities()

  return Response.json({
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      label: 'Persistent history, bookmarks, and search memory',
    },
    searxng: {
      configured: Boolean(process.env.SEARXNG_URL),
      label: 'Self-hosted SearXNG search source',
    },
    localEmbeddings: {
      configured: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      label: 'Local sentence-transformer embeddings',
    },
    gemini: {
      configured: gemini.configured,
      label: gemini.configured
        ? `Semantic intent planner · ${gemini.model}`
        : 'Semantic intent planner',
    },
    cloudflare: {
      configured: cloudflare.configured,
      label: cloudflare.configured
        ? `Candidate semantic reranker · ${cloudflare.model}`
        : 'Candidate semantic reranker',
    },
    cerebras: {
      configured: providers.cerebras.configured,
      label: providers.cerebras.configured
        ? `Primary smart filter · ${providers.cerebras.model}`
        : 'Primary smart-filter provider',
    },
    groq: {
      configured: providers.groq.configured,
      label: providers.groq.configured
        ? `Fallback · ${providers.groq.smartModel} · Review · ${providers.groq.reviewModel}`
        : 'Fallback and review smart-filter provider',
    },
    evidenceValidation: {
      configured: true,
      label: 'Deep page inspection, lifecycle detection, entity deduplication, and streaming verification',
    },
    ocr: {
      configured: process.env.ENABLE_OCR === 'true',
      label: 'Image and scanned-document OCR',
    },
  })
}
