import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { geminiGroundedSearchCapabilities } from '../../../lib/gemini-grounded-search'
import { managedSearchCapabilities } from '../../../lib/managed-search'
import { OCCUMED_HISTORICAL_PURSUIT_SEEDS } from '../../../lib/occumed-historical-pursuits'
import { OCCUMED_OFFICIAL_SOURCES, OCCUMED_PROFILE_VERSION } from '../../../lib/occumed-rfp-profile'
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
  const geminiSearch = geminiGroundedSearchCapabilities()
  const cloudflare = cloudflareRerankCapabilities()
  const managedSearch = managedSearchCapabilities()

  return {
    status: 'ok',
    service: 'ultra-search-browser',
    productMode: 'rfp-finder-www',
    searchPipeline: 'rfp-finder-v4-package-intelligence-learning',
    commit: deployedCommit(),
    capabilities: {
      database: Boolean(process.env.DATABASE_URL),
      searxng: Boolean(process.env.SEARXNG_URL),
      localEmbeddings: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      geminiIntentPlanner: gemini.configured,
      geminiIntentModel: gemini.model,
      geminiGroundedSearch: geminiSearch.configured,
      geminiGroundedSearchModel: geminiSearch.model,
      geminiGroundedSearchPolicy: 'weak-coverage-only',
      samGovOfficialApi: Boolean(process.env.SAM_GOV_API_KEY?.trim()),
      structuredIntentPlanning: true,
      procurementOnly: true,
      sourceAgnosticRfpSearch: true,
      occuMedRelevanceProfile: true,
      occuMedRelevanceProfileVersion: OCCUMED_PROFILE_VERSION,
      occuMedOfficialSources: OCCUMED_OFFICIAL_SOURCES,
      historicalPursuitSeedCount: OCCUMED_HISTORICAL_PURSUIT_SEEDS.length,
      mandatoryShowReviewRejectGate: true,
      primaryResultsRequireShowDecision: true,
      expiredAndIrrelevantHiddenFromPrimaryResults: true,
      completeSolicitationPackageInspection: true,
      attachmentAndAmendmentInspection: true,
      structuredOpportunityIntelligence: true,
      adaptiveWaveValidation: true,
      adaptiveValidationTarget: 10,
      pageValidationMaxTargets: 48,
      solicitationIdentityDeduplication: true,
      pursuitFeedbackLearning: Boolean(process.env.DATABASE_URL),
      localPursuitWorkspace: true,
      taskAwareReranking: true,
      managedSearch: managedSearch.configured,
      managedSearchProviders: managedSearch.providers,
      configuredButUnwiredSearchKeys: managedSearch.configuredButUnwired,
      publicWebRfpSources: ['bing-rss', 'duckduckgo-lite', 'mojeek', 'yahoo', 'brave'],
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
      pageValidationCache: pageValidationCacheStats(),
      ocr: process.env.ENABLE_OCR === 'true',
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
