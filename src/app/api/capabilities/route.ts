import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { isSearxngConfigured } from '../../../lib/searxng'

export async function GET() {
  const providers = externalSmartFilterCapabilities()
  const cloudflare = cloudflareRerankCapabilities()
  const searxngConfigured = isSearxngConfigured()

  return Response.json({
    searxngSearch: {
      configured: true,
      label: searxngConfigured
        ? 'Private SearXNG metasearch is configured for zero-key server retrieval'
        : 'SearXNG transport is enabled; bounded DuckDuckGo/Bing rescue remains available until SEARXNG_URL is configured',
    },
    deterministicIntent: {
      configured: true,
      label: 'Occu-Med query planning and buyer-language expansion run without an external AI planner',
    },
    serverSideSearchRetrieval: {
      configured: true,
      label: 'Ultra Search retrieves search results server-side — no download or browser extension required',
    },
    zeroKeyDirectRescue: {
      configured: true,
      label: 'Bounded DuckDuckGo/Bing rescue keeps retrieval key-free when SearXNG is sparse or unavailable',
    },
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      label: 'Persistent history, bookmarks, feedback, and pursuit learning',
    },
    evidenceValidation: {
      configured: true,
      label: 'Deep page inspection, lifecycle detection, entity deduplication, and SHOW/REVIEW/REJECT verification',
    },
    localEmbeddings: {
      configured: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      label: 'Optional local sentence-transformer embeddings',
    },
    ocr: {
      configured: process.env.ENABLE_OCR === 'true',
      label: 'Optional image and scanned-document OCR',
    },
    optionalEnhancements: {
      cloudflare: {
        configured: cloudflare.configured,
        label: cloudflare.configured ? `Optional semantic reranker · ${cloudflare.model}` : 'Optional semantic reranker',
      },
      cerebras: {
        configured: providers.cerebras.configured,
        label: providers.cerebras.configured ? `Optional evidence reviewer · ${providers.cerebras.model}` : 'Optional evidence reviewer',
      },
      groq: {
        configured: providers.groq.configured,
        label: providers.groq.configured ? `Optional fallback evidence review · ${providers.groq.reviewModel}` : 'Optional fallback evidence review',
      },
    },
  })
}
