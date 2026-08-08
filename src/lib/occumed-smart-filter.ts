import {
  applySmartFilter,
  type SmartFilterDiagnostics,
  type SmartFilterOptions,
} from './smart-filter'
import {
  alignOccuMedSemanticIntent,
  isBroadOccuMedCapabilityQuery,
} from './occumed-capability-matching'
import {
  assessOccuMedRfpText,
  augmentOccuMedSemanticIntent,
} from './occumed-rfp-profile'
import type { ScrapedResult, SearchLens } from '../types/search'

export type { SmartFilterDiagnostics }

function resultEvidenceText(result: ScrapedResult): string {
  return [
    result.title,
    result.description,
    result.content,
    result.url,
    result.domain,
    result.pageValidation?.evidence?.join(' '),
    result.pageValidation?.lifecycle.reason,
  ].filter(Boolean).join(' ')
}

function applyUmbrellaOccuMedFilter(
  query: string,
  results: ScrapedResult[],
  displayLimit: number
): { results: ScrapedResult[]; diagnostics: SmartFilterDiagnostics } {
  const classified = results.map(result => {
    const assessment = assessOccuMedRfpText(resultEvidenceText(result))
    const hardExcluded = assessment.exclusions.length > 0
    const status = hardExcluded || assessment.status === 'irrelevant'
      ? 'rejected' as const
      : assessment.status === 'relevant'
        ? 'valid' as const
        : 'uncertain' as const
    const scoreAdjustment = status === 'valid'
      ? Math.round(assessment.score * 24)
      : status === 'uncertain'
        ? 4
        : -45

    return {
      ...result,
      score: result.score + scoreAdjustment,
      validation: {
        status,
        relevance: Number(assessment.score.toFixed(3)),
        reason: hardExcluded
          ? `Rejected by Occu-Med hard exclusions: ${assessment.exclusions.slice(0, 3).join(', ')}.`
          : assessment.reason,
        matchedConcepts: assessment.matchedCapabilities,
        mode: 'local-rules' as const,
      },
    }
  })

  const valid = classified
    .filter(result => result.validation.status === 'valid')
    .sort((left, right) => right.score - left.score)
  const uncertain = classified
    .filter(result => result.validation.status === 'uncertain')
    .sort((left, right) => right.score - left.score)
  const rejected = classified.filter(result => result.validation.status === 'rejected')
  const displayed = [...valid, ...uncertain]
    .slice(0, displayLimit)
    .map((result, index) => ({ ...result, rank: index + 1 }))

  return {
    results: displayed,
    diagnostics: {
      mode: 'local-rules',
      localModelEnabled: false,
      localModelUsed: false,
      externalConfigured: false,
      externalUsed: false,
      providerAttempts: [],
      candidateCount: results.length,
      validCount: valid.length,
      uncertainCount: uncertain.length,
      rejectedCount: rejected.length,
      displayedCount: displayed.length,
      interpretation: `${query.trim()} is an umbrella Occu-Med procurement search. Candidate-stage filtering accepts any shared Occu-Med capability family while preserving hard exclusions; deeper page validation still decides SHOW / REVIEW / REJECT.`,
      requiredConcepts: ['active procurement opportunity', 'any Occu-Med capable service'],
    },
  }
}

function externalSemanticReviewEnabled(): boolean {
  return process.env.ENABLE_EXTERNAL_SMART_FILTER === 'true'
}

export async function applyOccuMedSmartFilter(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[],
  displayLimit: number,
  options: SmartFilterOptions = {}
): Promise<{ results: ScrapedResult[]; diagnostics: SmartFilterDiagnostics }> {
  if (lens !== 'procurement') {
    return applySmartFilter(query, lens, results, displayLimit, options)
  }

  // The procurement candidate gate has already required real procurement
  // evidence before this stage. For true umbrella searches, reuse the shared
  // Occu-Med ontology assessment instead of coercing dozens of capability terms
  // through the generic 12-term concept normalizer. This keeps a one-family
  // sparse candidate visible as uncertain for destination-page review while
  // still rejecting hard exclusions and genuinely irrelevant scope.
  if (isBroadOccuMedCapabilityQuery(query)) {
    return applyUmbrellaOccuMedFilter(query, results, displayLimit)
  }

  const augmentedIntent = augmentOccuMedSemanticIntent(options.semanticIntent)
  const alignedIntent = alignOccuMedSemanticIntent(query, augmentedIntent)
  const useExternalProviders = options.useExternalProviders === true
    && externalSemanticReviewEnabled()

  return applySmartFilter(query, lens, results, displayLimit, {
    ...options,
    // Core procurement review is deterministic and zero-key by default. Merely
    // having a trial Cerebras/Groq key present in Render must not alter latency
    // or classification. External semantic reviewers are an explicit opt-in.
    useExternalProviders,
    semanticIntent: alignedIntent,
  })
}
