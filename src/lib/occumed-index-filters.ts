/**
 * Compatibility shim for structured feeds.
 * Hard-coded Occu-Med NAICS/title/positive/negative vocabularies were removed.
 * Canonical service relevance belongs in OCCU_MED_AWARE (Neon).
 */
export const OCCUMED_NAICS: readonly string[] = []
export const OCCUMED_SAM_TITLE_QUERIES: readonly string[] = []
export const OCCUMED_POSITIVE_PATTERNS: RegExp[] = []
export const OCCUMED_NEGATIVE_PATTERNS: RegExp[] = []

export function textMatchesOccuMed(_text: string): boolean {
  return true
}

export function naicsMatchesOccuMed(_naics: string | null | undefined): boolean {
  return false
}

export function isOccuMedRelevant(_params: {
  title?: string
  description?: string
  naics?: string | null
}): boolean {
  return true
}
