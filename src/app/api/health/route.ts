import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { pageValidationCacheStats } from '../../../lib/page-validation'
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
  const cloudflare = cloudflareRerankCapabilities()

  return {
    status: 'ok',
    service: 'ultra-search-browser',
    searchPipeline: 'orchestrated-v6-task-aware-intent',
    commit: deployedCommit(),
    capabilities: {
      database: Boolean(process.env.DATABASE_URL),
      searxng: Boolean(process.env.SEARXNG_URL),
      localEmbeddings: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      geminiIntentPlanner: gemini.configured,
      geminiIntentModel: gemini.model,
      structuredIntentPlanning: true,
      taskAwareReranking: true,
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
