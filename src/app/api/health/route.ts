import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { geminiGroundedSearchCapabilities } from '../../../lib/gemini-grounded-search'
import { managedSearchCapabilities } from '../../../lib/managed-search'
import { pageValidationCacheStats } from '../../../lib/page-validation'
import { samGovOpportunityCapabilities } from '../../../lib/sam-gov-opportunities'
import { semanticIntentCapabilities } from '../../../lib/semantic-intent'

export const dynamic = 'force-dynamic'

function deployedCommit(): string {
  return (
    process.env.RENDER_GIT_COMMIT
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || 'unknown'
  )
}

function healthPayload() {
  const providers = externalSmartFilterCapabilities()
  const gemini = semanticIntentCapabilities()
  const geminiSearch = geminiGroundedSearchCapabilities()
  const cloudflare = cloudflareRerankCapabilities()
  const managedSearch = managedSearchCapabilities()
  const samGov = samGovOpportunityCapabilities()

  return {
    status: 'ok',
    service: 'ultra-search-browser',
    searchPipeline: 'orchestrated-v11-sam-gov-procurement',
    commit: deployedCommit(),
    capabilities: {
      database: Boolean(process.env.DATABASE_URL),
      searxng: Boolean(process.env.SEARXNG_URL),
      localEmbeddings: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      geminiIntentPlanner: gemini.configured,
      geminiIntentModel: gemini.model,
      geminiGroundedSearch: geminiSearch.configured,
      geminiGroundedSearchModel: geminiSearch.model,
      structuredIntentPlanning: true,
      taskAwareReranking: true,
      managedSearch: managedSearch.configured,
      managedSearchProviders: managedSearch.providers,
      configuredButUnwiredSearchKeys: managedSearch.configuredButUnwired,
      samGovOpportunities: samGov.configured,
      automaticBrowserSearchFallback: true,
      automaticBrowserSearchSources: ['bing-rss', 'duckduckgo-lite', 'mojeek'],
      legacyHtmlSearch: process.env.ENABLE_LEGACY_HTML_SEARCH === 'true',
      cloudflareReranker: cloudflare.configured,
      cloudflareRerankModel: cloudflare.model,
      cerebrasSmartFilter: providers.cerebras.configured,
      cerebrasSmartModel: providers.cerebras.model,
      groqSmartFilter: providers.groq.configured,
      groqSmartModel: providers.groq.smartModel,
      groqReviewModel: providers.groq.reviewModel,
      deepPageValidation: true,
      streamingValidation: true,
      lifecycleDetection: true,
      entityDeduplication: true,
      pageValidationMaxTargets: 24,
      pageValidationCache: pageValidationCacheStats(),
      ocr: process.env.ENABLE_OCR === 'true',
      marginalia: process.env.ENABLE_MARGINALIA !== 'false',
    },
    checkedAt: new Date().toISOString(),
  }
}

export async function GET() {
  return Response.json(healthPayload(), {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
