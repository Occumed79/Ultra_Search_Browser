import {
  applySmartFilter,
  type SmartFilterDiagnostics,
  type SmartFilterOptions,
} from './smart-filter'
import {
  alignOccuMedSemanticIntent,
  isBroadOccuMedCapabilityQuery,
  matchOccuMedCapabilityGroups,
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

function preserveSparseCapabilityMatches(
  query: string,
  sourceResults: ScrapedResult[],
  filtered: { results: ScrapedResult[]; diagnostics: SmartFilterDiagnostics },
  displayLimit: number
): { results: ScrapedResult[]; diagnostics: SmartFilterDiagnostics } {
  if (filtered.results.length >= displayLimit || sourceResults.length === 0) return filtered

  const requestedCapabilities = new Set(
    matchOccuMedCapabilityGroups(query, 3).map(group => group.label)
  )
  if (requestedCapabilities.size === 0) return filtered

  const existingUrls = new Set(filtered.results.map(result => result.url))
  const rescueLimit = Math.max(0, displayLimit - filtered.results.length)
  const rescued = sourceResults
    .filter(result => !existingUrls.has(result.url))
    .map(result => ({ result, assessment: assessOccuMedRfpText(resultEvidenceText(result)) }))
    .filter(({ assessment }) =>
      assessment.exclusions.length === 0
      && assessment.matchedCapabilities.some(label => requestedCapabilities.has(label))
    )
    .sort((left, right) => right.result.score - left.result.score)
    .slice(0, rescueLimit)
    .map(({ result, assessment }) => ({
      ...result,
      score: result.score + 3,
      validation: {
        status: 'uncertain' as const,
        relevance: Number(Math.max(0.35, assessment.score).toFixed(3)),
        reason: 'Sparse procurement snippet matches the requested Occu-Med capability family; retaining it for destination-page and solicitation-package validation.',
        matchedConcepts: assessment.matchedCapabilities,
        mode: 'local-rules' as const,
      },
    }))

  if (rescued.length === 0) return filtered

  const results = [...filtered.results, ...rescued]
    .slice(0, displayLimit)
    .map((result, index) => ({ ...result, rank: index + 1 }))

  return {
    results,
    diagnostics: {
      ...filtered.diagnostics,
      uncertainCount: filtered.diagnostics.uncertainCount + rescued.length,
      rejectedCount: Math.max(0, filtered.diagnostics.rejectedCount - rescued.length),
      displayedCount: results.length,
      interpretation: `${filtered.diagnostics.interpretation} Sparse candidates that independently match the requested Occu-Med capability family are retained as uncertain for deep destination validation rather than being discarded from snippet evidence alone.`,
    },
  }
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

  if (isBroadOccuMedCapabilityQuery(query)) {
    return applyUmbrellaOccuMedFilter(query, results, displayLimit)
  }

  const augmentedIntent = augmentOccuMedSemanticIntent(options.semanticIntent)
  const alignedIntent = alignOccuMedSemanticIntent(query, augmentedIntent)
  const useExternalProviders = options.useExternalProviders === true
    && externalSemanticReviewEnabled()

  const filtered = await applySmartFilter(query, lens, results, displayLimit, {
    ...options,
    useExternalProviders,
    semanticIntent: alignedIntent,
  })

  return preserveSparseCapabilityMatches(query, results, filtered, displayLimit)
}
