import type { ScrapedResult } from '../types/search'

const ELIGIBLE_LIFECYCLE_STATUSES = new Set(['open', 'active', 'current', 'unknown'])

export function isVerifiedResult(result: ScrapedResult): boolean {
  const lifecycle = result.pageValidation?.lifecycle.status
  return Boolean(
    result.url
    && result.title
    && result.bucket === 'valid'
    && result.validation?.status === 'valid'
    && result.pageValidation?.availability === 'reachable'
    && lifecycle
    && ELIGIBLE_LIFECYCLE_STATUSES.has(lifecycle)
  )
}

export function verifiedResultsOnly(results: ScrapedResult[]): ScrapedResult[] {
  return results.filter(isVerifiedResult)
}

/** Procurement UI requires an open notice and the completed canonical verdict. */
export function isVerifiedOpportunity(result: ScrapedResult): boolean {
  const decision = (result as ScrapedResult & { canonicalDecision?: { decision: string } }).canonicalDecision
  return isVerifiedResult(result)
    && ['open', 'active'].includes(result.pageValidation!.lifecycle.status)
    && decision?.decision === 'SHOW'
}

export function verifiedOpportunitiesOnly(results: ScrapedResult[]): ScrapedResult[] {
  return results.filter(isVerifiedOpportunity)
}
