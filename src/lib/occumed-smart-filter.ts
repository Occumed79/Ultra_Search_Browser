import {
  applySmartFilter,
  type SmartFilterDiagnostics,
  type SmartFilterOptions,
} from './smart-filter'
import { alignOccuMedSemanticIntent } from './occumed-capability-matching'
import { augmentOccuMedSemanticIntent } from './occumed-rfp-profile'
import type { ScrapedResult, SearchLens } from '../types/search'

export type { SmartFilterDiagnostics }

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

  const augmentedIntent = augmentOccuMedSemanticIntent(options.semanticIntent)
  const alignedIntent = alignOccuMedSemanticIntent(query, augmentedIntent)

  return applySmartFilter(query, lens, results, displayLimit, {
    ...options,
    semanticIntent: alignedIntent,
  })
}
