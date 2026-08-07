import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { OCCUMED_HISTORICAL_PURSUIT_SEEDS } from '../../../lib/occumed-historical-pursuits'
import { OCCUMED_OFFICIAL_SOURCES, OCCUMED_PROFILE_VERSION } from '../../../lib/occumed-rfp-profile'
import { pageValidationCacheStats } from '../../../lib/page-validation'

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
  const cloudflare = cloudflareRerankCapabilities()

  return {
    status: 'ok',
    service: 'ultra-search-browser',
    productMode: 'rfp-finder-browser-fed',
    searchPipeline: 'rfp-finder-v5-browser-fed-zero-key',
    commit: deployedCommit(),
    capabilities: {
      database: Boolean(process.env.DATABASE_URL),
      browserFedSearch: true,
      browserCompanionRequired: true,
      serverSideSearchRetrieval: false,
      coreSearchApiKeysRequired: false,
      deterministicIntentPlanning: true,
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
      cloudflareReranker: cloudflare.configured,
      cloudflareRerankModel: cloudflare.model,
      cerebrasSmartFilter: providers.cerebras.configured,
      cerebrasSmartModel: providers.cerebras.model,
      groqSmartFilter: providers.groq.configured,
      groqSmartModel: providers.groq.smartModel,
      groqReviewModel: providers.groq.reviewModel,
      candidateFilteringUsesExternalProviders: false,
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
