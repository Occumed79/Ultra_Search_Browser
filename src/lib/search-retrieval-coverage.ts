export interface RetrievalCoverageInput {
  uniqueCandidateCount: number
  successfulSearches: number
  attemptedSearches: number
  minimumUniqueCandidates?: number
  minimumSuccessfulSearches?: number
}

export interface RescueSearchVariant {
  query: string
  purpose: string
}

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source',
])

const RESCUE_PURPOSE_ORDER = [
  'official',
  'document',
  'portal',
  'ai-intent',
  'freshness',
  'intent-core',
  'broad',
  'semantic',
]

export function canonicalRetrievalUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase()
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function distinctRetrievalCoverage(results: Array<{ url: string }>): number {
  const urls = new Set<string>()
  for (const result of results) {
    const canonical = canonicalRetrievalUrl(result.url)
    if (canonical) urls.add(canonical)
  }
  return urls.size
}

export function shouldRunDirectRescue(input: RetrievalCoverageInput): boolean {
  const minimumUniqueCandidates = Math.max(4, input.minimumUniqueCandidates ?? 12)
  const targetSuccessfulSearches = Math.max(
    1,
    Math.min(
      input.attemptedSearches,
      input.minimumSuccessfulSearches ?? Math.min(3, input.attemptedSearches)
    )
  )

  return input.uniqueCandidateCount < minimumUniqueCandidates
    || input.successfulSearches < targetSuccessfulSearches
}

/**
 * Direct public-engine rescue is expensive enough that its slots should be
 * complementary, not simply the first N planner variants. Prefer official,
 * direct-document, portal, buyer-language, and freshness strategies before a
 * generic broad query that tends to rediscover provider websites.
 */
export function selectDirectRescueVariants<T extends RescueSearchVariant>(
  variants: T[],
  maxVariants = 5
): T[] {
  const limit = Math.max(1, Math.min(8, maxVariants))
  const selected: T[] = []
  const usedQueries = new Set<string>()

  const add = (variant: T | undefined) => {
    if (!variant || selected.length >= limit) return
    const key = variant.query.trim().toLowerCase()
    if (!key || usedQueries.has(key)) return
    usedQueries.add(key)
    selected.push(variant)
  }

  for (const purpose of RESCUE_PURPOSE_ORDER) {
    add(variants.find(variant => variant.purpose === purpose))
    if (selected.length >= limit) return selected
  }

  for (const variant of variants) {
    add(variant)
    if (selected.length >= limit) break
  }
  return selected
}
