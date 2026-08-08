import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { databaseSchemaState } from '../../../lib/database-schema-lifecycle'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { headlessRecoveryCapabilities } from '../../../lib/headless-page-recovery'
import {
  OCCUMED_HISTORICAL_PURSUIT_SEEDS,
  OCCUMED_VERIFIED_AWARD_SEEDS,
} from '../../../lib/occumed-historical-pursuits'
import { OCCUMED_OFFICIAL_SOURCES, OCCUMED_PROFILE_VERSION } from '../../../lib/occumed-rfp-profile'
import { pageValidationCacheStats } from '../../../lib/page-validation'
import { isSearxngConfigured } from '../../../lib/searxng'
import { searchFlightRecorderStats } from '../../../lib/search-flight-recorder'
import { searchSourceHealthSnapshot } from '../../../lib/search-source-health'

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
  const searxngConfigured = isSearxngConfigured()
  const headless = headlessRecoveryCapabilities()
  const schema = databaseSchemaState()
  const verifiedPrimeAwardSeedCount = OCCUMED_VERIFIED_AWARD_SEEDS.filter(seed => seed.evidenceType === 'verified-prime-award').length
  const verifiedSubawardSeedCount = OCCUMED_VERIFIED_AWARD_SEEDS.filter(seed => seed.evidenceType === 'verified-subcontract-award').length
  const verifiedPerformanceSeedCount = OCCUMED_VERIFIED_AWARD_SEEDS.filter(seed => seed.evidenceType === 'verified-performance-record').length

  return {
    status: 'ok',
    service: 'ultra-search-browser',
    productMode: 'rfp-finder-searxng',
    searchPipeline: 'rfp-finder-v6-searxng-zero-key',
    commit: deployedCommit(),
    capabilities: {
      database: Boolean(process.env.DATABASE_URL),
      databaseSchema: schema,
      databaseSchemaReady: schema.status === 'ready' || schema.status === 'disabled',
      browserFedSearch: false,
      browserCompanionRequired: false,
      downloadsRequired: false,
      extensionsRequired: false,
      serverSideSearchRetrieval: true,
      searxngSearch: true,
      searxngConfigured,
      zeroKeyDirectRescue: true,
      retrievalCircuitBreakers: true,
      retrievalSourceHealth: searchSourceHealthSnapshot(),
      searchFlightRecorder: searchFlightRecorderStats(),
      searchTraceDiagnosticsEndpoint: '/api/diagnostics/search-traces',
      coreSearchApiKeysRequired: false,
      deterministicIntentPlanning: true,
      structuredIntentPlanning: true,
      procurementOnly: true,
      sourceAgnosticRfpSearch: true,
      occuMedRelevanceProfile: true,
      occuMedRelevanceProfileVersion: OCCUMED_PROFILE_VERSION,
      occuMedOfficialSources: OCCUMED_OFFICIAL_SOURCES,
      historicalPursuitSeedCount: OCCUMED_HISTORICAL_PURSUIT_SEEDS.length,
      verifiedHistoricalAwardSeedCount: OCCUMED_VERIFIED_AWARD_SEEDS.length,
      verifiedPrimeAwardSeedCount,
      verifiedHistoricalSubawardSeedCount: verifiedSubawardSeedCount,
      verifiedHistoricalPerformanceSeedCount: verifiedPerformanceSeedCount,
      historicalAwardsAreSimilarityEvidenceOnly: true,
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
      embeddedClientStateRecovery: true,
      headlessClientRenderedRecovery: headless.enabled,
      headlessRecoveryConfigured: headless.configured,
      headlessRecoveryBudget: {
        maxConcurrency: headless.maxConcurrency,
        maxPerMinute: headless.maxPerMinute,
        timeoutMs: headless.timeoutMs,
      },
      ocr: process.env.ENABLE_OCR === 'true',
      scannedPdfOcr: process.env.ENABLE_OCR === 'true',
      pdfOcrRasterizer: process.env.PDFTOPPM_PATH?.trim() ? 'configured-path' : 'system-path',
    },
    checkedAt: new Date().toISOString(),
  }
}

export async function GET() {
  return Response.json(healthPayload(), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
