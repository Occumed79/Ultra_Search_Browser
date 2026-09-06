import { cloudflareRerankCapabilities } from '../../../lib/cloudflare-reranker'
import { databaseSchemaState } from '../../../lib/database-schema-lifecycle'
import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'
import { headlessRecoveryCapabilities } from '../../../lib/headless-page-recovery'
import { isKeenableConfigured, keenableKeyCount } from '../../../lib/keenable'
import {
  OCCUMED_HISTORICAL_PURSUIT_SEEDS,
  OCCUMED_VERIFIED_AWARD_SEEDS,
} from '../../../lib/occumed-historical-pursuits'
import { OCCUMED_OFFICIAL_SOURCES, OCCUMED_PROFILE_VERSION } from '../../../lib/occumed-rfp-profile'
import { pageValidationCacheStats } from '../../../lib/page-validation'
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
  const externalSemanticReviewEnabled = process.env.ENABLE_EXTERNAL_SMART_FILTER === 'true'
  const verifiedPrimeAwardSeedCount = OCCUMED_VERIFIED_AWARD_SEEDS.filter(seed => seed.evidenceType === 'verified-prime-award').length
  const verifiedSubawardSeedCount = OCCUMED_VERIFIED_AWARD_SEEDS.filter(seed => seed.evidenceType === 'verified-subcontract-award').length
  const verifiedPerformanceSeedCount = OCCUMED_VERIFIED_AWARD_SEEDS.filter(seed => seed.evidenceType === 'verified-performance-record').length
  const liveSearchSources = {
    searxng: {
      configured: searxngConfigured,
      engines: configuredSearxngEngines(),
    },
    keenable: {
      configured: isKeenableConfigured(),
      keyCount: keenableKeyCount(),
    },
    tinyfish: {
      configured: isTinyFishConfigured(),
      keyCount: tinyFishKeyCount(),
    },
    tavily: {
      configured: isTavilyConfigured(),
      keyCount: tavilyKeyCount(),
    },
    exa: {
      configured: isExaConfigured(),
      keyCount: exaKeyCount(),
    },
    langsearch: {
      configured: isLangSearchConfigured(),
      keyCount: langSearchKeyCount(),
    },
  }

  return {
    status: 'ok',
    service: 'ultra-search-browser',
    productMode: 'rfp-finder-searxng',
    searchPipeline: 'rfp-finder-v7-multisource',
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
      searxngRequestedEngines: configuredSearxngEngines(),
      liveMultiSourceSearch: true,
      liveSearchSources,
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
      cerebrasSmartKeyCount: providers.cerebras.keyCount,
      cerebrasSmartModel: providers.cerebras.model,
      groqSmartFilter: providers.groq.configured,
      groqSmartModel: providers.groq.smartModel,
      groqReviewModel: providers.groq.reviewModel,
      externalSemanticReviewEnabled,
      candidateFilteringUsesExternalProviders: false,
      deepValidationUsesExternalProviders: externalSemanticReviewEnabled,
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