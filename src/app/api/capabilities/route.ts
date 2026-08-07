import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'

export async function GET() {
  const providers = externalSmartFilterCapabilities()
  const cloudflare = cloudflareRerankCapabilities()

  return Response.json({
    browserFedSearch: {
      configured: true,
      label: 'Core retrieval runs through the browser companion with no search API keys',
    },
    deterministicIntent: {
      configured: true,
      label: 'Occu-Med query planning and buyer-language expansion run without an external AI planner',
    },
    serverSideSearchRetrieval: {
      configured: false,
      label: 'Disabled by design — Render does not act as a search engine',
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
        label: cloudflare.configured
          ? `Optional semantic reranker · ${cloudflare.model}`
          : 'Optional semantic reranker',
      },
      cerebras: {
        configured: providers.cerebras.configured,
        label: providers.cerebras.configured
          ? `Optional evidence reviewer · ${providers.cerebras.model}`
          : 'Optional evidence reviewer',
      },
      groq: {
        configured: providers.groq.configured,
        label: providers.groq.configured
          ? `Optional fallback evidence review · ${providers.groq.reviewModel}`
          : 'Optional fallback evidence review',
      },
    },
  })
}
