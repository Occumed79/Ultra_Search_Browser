import {
  applySmartFilter,
  type SmartFilterDiagnostics,
  type SmartFilterOptions,
} from './smart-filter'
import type { ScrapedResult, SearchLens } from '../types/search'

export type { SmartFilterDiagnostics }

/**
 * Compatibility wrapper.
 * All hard-coded Occu-Med relevance logic has been removed from this layer.
 * Until the canonical Neon decision is wired into Ultra Search, this delegates
 * only to the generic complete-query smart filter.
 */
export async function applyOccuMedSmartFilter(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[],
  displayLimit: number,
  options: SmartFilterOptions = {}
): Promise<{ results: ScrapedResult[]; diagnostics: SmartFilterDiagnostics }> {
  return applySmartFilter(query, lens, results, displayLimit, options)
}
