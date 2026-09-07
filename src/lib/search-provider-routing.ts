import type { BrowserSearchVariant } from './browser-search-pipeline'
import type { QueryPurpose } from './search-planner'

export type DiscoveryProviderName = 'Keenable' | 'TinyFish' | 'Tavily' | 'Exa' | 'LangSearch'

const PROVIDER_PURPOSE_ORDER: Record<DiscoveryProviderName, QueryPurpose[]> = {
  Keenable: ['ai-intent', 'official', 'document', 'freshness', 'portal', 'broad', 'intent-core', 'semantic'],
  TinyFish: ['ai-intent', 'freshness', 'official', 'portal', 'document', 'broad', 'intent-core', 'semantic'],
  Tavily: ['ai-intent', 'freshness', 'official', 'document', 'broad', 'portal', 'intent-core', 'semantic'],
  Exa: ['ai-intent', 'freshness', 'broad', 'official', 'intent-core', 'document', 'portal', 'semantic'],
  LangSearch: ['ai-intent', 'official', 'freshness', 'document', 'broad', 'portal', 'intent-core', 'semantic'],
}

/**
 * Keyed discovery providers should not spend their entire renewable quota on
 * the literal user query and its near-duplicate intent-core form. Ultra Search
 * is an RFP finder, so every configured provider gets procurement-bearing
 * variants first, while still retaining a broad query when its budget allows.
 *
 * The first pass deliberately takes at most one query from each purpose to keep
 * the provider budget diverse. A second pass fills any remaining slots by the
 * provider-specific preference order and then by planner priority.
 */
export function selectProviderSearchVariants(
  provider: DiscoveryProviderName,
  variants: BrowserSearchVariant[],
  maxVariants: number
): BrowserSearchVariant[] {
  const limit = Math.max(1, Math.min(12, Math.trunc(maxVariants) || 1))
  const selected: BrowserSearchVariant[] = []
  const seen = new Set<string>()
  const purposeOrder = PROVIDER_PURPOSE_ORDER[provider]

  const add = (variant: BrowserSearchVariant | undefined) => {
    if (!variant || selected.length >= limit || seen.has(variant.id)) return
    seen.add(variant.id)
    selected.push(variant)
  }

  for (const purpose of purposeOrder) {
    const best = variants
      .filter(variant => variant.purpose === purpose)
      .sort((left, right) => right.priority - left.priority)[0]
    add(best)
    if (selected.length >= limit) return selected
  }

  const purposeRank = new Map(purposeOrder.map((purpose, index) => [purpose, index]))
  const remaining = variants
    .filter(variant => !seen.has(variant.id))
    .sort((left, right) => {
      const leftPurpose = purposeRank.get(left.purpose) ?? purposeOrder.length
      const rightPurpose = purposeRank.get(right.purpose) ?? purposeOrder.length
      return leftPurpose - rightPurpose || right.priority - left.priority
    })

  for (const variant of remaining) {
    add(variant)
    if (selected.length >= limit) break
  }

  return selected
}
