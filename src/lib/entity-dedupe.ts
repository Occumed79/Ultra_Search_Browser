import type { ScrapedResult, SearchLens } from '../types/search'

export interface EntityDedupeOutcome {
  results: ScrapedResult[]
  duplicateCount: number
  groupCount: number
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of',
  'on', 'or', 'the', 'to', 'with', 'official', 'page', 'website', 'home', 'document',
  'pdf', 'request', 'notice', 'opportunity', 'services', 'service', 'solicitation',
])

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleTokens(result: ScrapedResult): Set<string> {
  return new Set(
    normalize(result.title)
      .split(' ')
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token))
  )
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

function referenceIdentifier(result: ScrapedResult): string | undefined {
  const text = `${result.title} ${result.description}`
  const match = text.match(/\b(?:rfp|rfq|ifb|rfi|bid|solicitation|tender|notice|contract)\s*(?:no\.?|number|#|id)?\s*[:#-]?\s*([a-z0-9][a-z0-9._\/-]{3,})\b/i)
  return match?.[1]?.toLowerCase()
}

function intelligenceEntity(result: ScrapedResult): string {
  const intelligence = result.intelligence as unknown as Record<string, unknown> | undefined
  const values = [
    intelligence?.organization,
    intelligence?.provider_name,
    intelligence?.company_name,
    intelligence?.service,
    intelligence?.service_name,
    intelligence?.due_date,
    intelligence?.decision_date,
    intelligence?.publication_date,
    intelligence?.city,
    intelligence?.state,
  ]
  return normalize(values.filter(value => typeof value === 'string').join(' '))
}

function likelyDuplicate(left: ScrapedResult, right: ScrapedResult, lens: SearchLens): boolean {
  const leftId = referenceIdentifier(left)
  const rightId = referenceIdentifier(right)
  if (leftId && rightId && leftId === rightId) return true

  const similarity = jaccard(titleTokens(left), titleTokens(right))
  const leftEntity = intelligenceEntity(left)
  const rightEntity = intelligenceEntity(right)
  const entityMatch = Boolean(leftEntity && rightEntity && (leftEntity.includes(rightEntity) || rightEntity.includes(leftEntity)))

  if (lens === 'procurement') return similarity >= 0.7 && (entityMatch || similarity >= 0.84)
  if (lens === 'provider' || lens === 'pricing') return similarity >= 0.78 || (similarity >= 0.62 && entityMatch)
  return similarity >= 0.86
}

function sourcePriority(result: ScrapedResult): number {
  const domain = result.domain.toLowerCase()
  const lifecycle = result.pageValidation?.lifecycle.status
  let score = result.score
  if (domain.endsWith('.gov') || domain.endsWith('.us')) score += 80
  if (domain.endsWith('.edu')) score += 45
  if (result.pageValidation?.availability === 'reachable') score += 25
  if (lifecycle === 'open' || lifecycle === 'active' || lifecycle === 'current') score += 20
  if (result.validation?.status === 'valid') score += 18
  score -= (result.spamScore || 0) * 0.8
  return score
}

function fingerprint(result: ScrapedResult, lens: SearchLens): string {
  const id = referenceIdentifier(result)
  if (id) return `${lens}:id:${id}`
  const tokens = Array.from(titleTokens(result)).sort().slice(0, 12).join('-')
  const entity = intelligenceEntity(result).split(' ').slice(0, 8).join('-')
  return `${lens}:${tokens}:${entity}`.slice(0, 240)
}

export function deduplicateEntities(results: ScrapedResult[], lens: SearchLens): EntityDedupeOutcome {
  const groups: ScrapedResult[][] = []

  for (const result of results) {
    const group = groups.find(existing => likelyDuplicate(existing[0], result, lens))
    if (group) group.push(result)
    else groups.push([result])
  }

  const merged = groups.map(group => {
    const ordered = [...group].sort((left, right) => sourcePriority(right) - sourcePriority(left))
    const primary = ordered[0]
    const alternateUrls = Array.from(new Set(ordered.slice(1).map(item => item.url)))
    const alternateSources = Array.from(new Set(ordered.slice(1).map(item => item.source)))
    const retrievalSources = Array.from(new Set(ordered.flatMap(item => item.retrieval?.sources || [item.source])))
    const retrievalQueries = Array.from(new Set(ordered.flatMap(item => item.retrieval?.queries || [])))
    const retrievalPurposes = Array.from(new Set(ordered.flatMap(item => item.retrieval?.purposes || [])))

    return {
      ...primary,
      score: Math.max(...ordered.map(item => item.score)) + Math.min(24, (group.length - 1) * 6),
      retrieval: {
        sources: retrievalSources,
        queries: retrievalQueries,
        purposes: retrievalPurposes,
        overlap: retrievalSources.length,
      },
      entity: {
        fingerprint: fingerprint(primary, lens),
        confirmationCount: group.length,
        alternateUrls,
        alternateSources,
        officialSource: primary.domain.endsWith('.gov') || primary.domain.endsWith('.us') || primary.domain.endsWith('.edu'),
      },
    }
  })

  merged.sort((left, right) => right.score - left.score)
  return {
    results: merged.map((result, index) => ({ ...result, rank: index + 1 })),
    duplicateCount: Math.max(0, results.length - merged.length),
    groupCount: merged.length,
  }
}
