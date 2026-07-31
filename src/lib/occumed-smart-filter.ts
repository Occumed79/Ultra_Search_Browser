import {
  applySmartFilter,
  type SmartFilterDiagnostics,
  type SmartFilterOptions,
} from './smart-filter'
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

  return applySmartFilter(query, lens, results, displayLimit, {
    ...options,
    semanticIntent: augmentOccuMedSemanticIntent(options.semanticIntent),
  })
}
