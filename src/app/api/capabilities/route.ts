import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { isKeenableConfigured, keenableKeyCount } from '../../../lib/keenable'
import {
  exaKeyCount,
  isExaConfigured,
  isLangSearchConfigured,
  isTavilyConfigured,
  isTinyFishConfigured,
  langSearchKeyCount,
  tavilyKeyCount,
  tinyFishKeyCount,
} from '../../../lib/renewable-search-providers'
import { configuredSearxngEngines, isSearxngConfigured } from '../../../lib/searxng'

export const dynamic = 'force-dynamic'

export async function GET() {
  const providers = externalSmartFilterCapabilities()
  const cloudflare = cloudflareRerankCapabilities()
  const searxngConfigured = isSearxngConfigured()
  const externalSemanticReviewEnabled = process.env.ENABLE_EXTERNAL_SMART_FILTER === 'true'

  return Response.json({
    searxngSearch: {
      configured: searxngConfigured,
      engines: configuredSearxngEngines(),
      label: searxngConfigured
        ? 'Private SearXNG primary metasearch explicitly requests the Ultra Search web-engine ensemble'
        : 'Private SearXNG is not connected yet; configured API search sources and direct fallback remain available',
    },
    liveSearchSources: {
      keenable: {
        configured: isKeenableConfigured(),
        keyCount: keenableKeyCount(),
        label: 'Keenable live-web discovery',
      },
      tinyfish: {
        configured: isTinyFishConfigured(),
        keyCount: tinyFishKeyCount(),
        label: 'TinyFish live ranked web search',
      },
      tavily: {
        configured: isTavilyConfigured(),
        keyCount: tavilyKeyCount(),
        label: 'Tavily live web search',
      },
      exa: {
        configured: isExaConfigured(),
        keyCount: exaKeyCount(),
        label: 'Exa semantic/live web search with dynamic highlights',
      },
      langsearch: {
        configured: isLangSearchConfigured(),
        keyCount: langSearchKeyCount(),
        label: 'LangSearch web search',
      },
    },
    deterministicIntent: {
      configured: true,
      label: 'Occu-Med query planning and buyer-language expansion run without an external AI planner',
    },
    serverSideSearchRetrieval: {
      configured: true,
      label: 'Ultra Search retrieves results server-side — no download or browser extension required',
    },
    zeroKeyDirectRescue: {
      configured: true,
      label: 'Direct Google/DuckDuckGo/Bing is an additional fallback when aggregate primary coverage is sparse; those engines are also requested through SearXNG primary retrieval',
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
        keyCount: providers.cerebras.keyCount,
        enabled: providers.cerebras.configured && externalSemanticReviewEnabled,
        label: providers.cerebras.configured
          ? `Optional post-validation evidence reviewer · ${providers.cerebras.model}`
          : 'Optional post-validation evidence reviewer',
      },
      groq: {
        configured: providers.groq.configured,
        enabled: providers.groq.configured && externalSemanticReviewEnabled,
        label: providers.groq.configured ? `Optional fallback evidence review · ${providers.groq.reviewModel}` : 'Optional fallback evidence review',
      },
    },
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}