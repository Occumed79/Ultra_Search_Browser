export type QualityLens =
  | 'web'
  | 'pdf'
  | 'government'
  | 'procurement'
  | 'pricing'
  | 'provider'
  | 'technical'
  | 'news'
  | 'legal'
  | 'medical'
  | 'academic'
  | 'financial'

export interface SearchQualityBenchmarkCase {
  id: string
  query: string
  lens: QualityLens
  requiredConcepts?: string[][]
  preferredDomains?: string[]
  expectOfficial?: boolean
  expectPdf?: boolean
  freshnessRequired?: boolean
  forbiddenTerms?: string[]
  notes?: string
}

export interface SearchQualityResult {
  title: string
  url: string
  description?: string
  domain?: string
  source?: string
  rank?: number
  score?: number
}

export interface SearchQualityJudgment {
  match: string
  grade: 0 | 1 | 2 | 3
}

export interface SearchQualityEvaluation {
  resultCount: number
  duplicateRate: number
  uniqueDomains: number
  uniqueSources: number
  topResultConceptCoverage: number
  topFiveConceptCoverage: number
  preferredDomainHitRank: number | null
  officialHitRank: number | null
  pdfHitRank: number | null
  staleResultRate: number
  forbiddenResultRate: number
  judgedResultCount: number
  ndcgAt10: number | null
  reciprocalRank: number | null
  grades: number[]
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizeQualityUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase()
      if (lower.startsWith('utm_') || lower === 'fbclid' || lower === 'gclid') {
        url.searchParams.delete(key)
      }
    }
    return url.toString().replace(/\/$/, '').toLowerCase()
  } catch {
    return value.trim().toLowerCase()
  }
}

export function qualityResultDomain(result: SearchQualityResult): string {
  if (result.domain?.trim()) return result.domain.trim().toLowerCase().replace(/^www\./, '')
  try {
    return new URL(result.url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function resultText(result: SearchQualityResult): string {
  return normalizeText(`${result.title || ''} ${result.description || ''} ${result.url || ''}`)
}

function matchesDomain(domain: string, expected: string): boolean {
  const normalized = expected.toLowerCase().replace(/^www\./, '')
  return domain === normalized || domain.endsWith(`.${normalized}`)
}

export function conceptCoverage(
  result: SearchQualityResult,
  requiredConcepts: string[][] = []
): number {
  if (!requiredConcepts.length) return 1
  const text = resultText(result)
  const matched = requiredConcepts.filter(group =>
    group.some(term => text.includes(normalizeText(term)))
  ).length
  return matched / requiredConcepts.length
}

export function duplicateRate(results: SearchQualityResult[]): number {
  if (!results.length) return 0
  const seen = new Set<string>()
  let duplicates = 0
  for (const result of results) {
    const key = normalizeQualityUrl(result.url)
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates / results.length
}

export function isOfficialResult(result: SearchQualityResult): boolean {
  const domain = qualityResultDomain(result)
  return domain.endsWith('.gov') || domain.endsWith('.mil') || domain.endsWith('.edu')
}

export function isPdfResult(result: SearchQualityResult): boolean {
  try {
    return new URL(result.url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return /\.pdf(?:$|[?#])/i.test(result.url)
  }
}

export function isStaleYearOnly(
  result: SearchQualityResult,
  currentYear = new Date().getFullYear()
): boolean {
  const years = Array.from(`${result.title} ${result.description || ''} ${result.url}`.matchAll(/\b20\d{2}\b/g))
    .map(match => Number(match[0]))
    .filter(Number.isFinite)
  if (!years.length) return false
  if (years.some(year => year >= currentYear - 1)) return false
  return years.every(year => year < currentYear - 1)
}

function judgmentGrade(result: SearchQualityResult, judgments: SearchQualityJudgment[]): number | null {
  const normalizedUrl = normalizeQualityUrl(result.url)
  const domain = qualityResultDomain(result)
  for (const judgment of judgments) {
    const match = judgment.match.trim()
    if (!match) continue
    if (match.startsWith('url:') && normalizedUrl.includes(match.slice(4).trim().toLowerCase())) {
      return judgment.grade
    }
    if (match.startsWith('domain:') && matchesDomain(domain, match.slice(7).trim())) {
      return judgment.grade
    }
    if (normalizedUrl.includes(match.toLowerCase())) return judgment.grade
  }
  return null
}

export function dcgAtK(grades: number[], k: number): number {
  return grades.slice(0, k).reduce((total, grade, index) => {
    const gain = Math.pow(2, Math.max(0, grade)) - 1
    return total + gain / Math.log2(index + 2)
  }, 0)
}

export function ndcgAtK(grades: number[], k: number): number | null {
  if (!grades.length) return null
  const ideal = [...grades].sort((left, right) => right - left)
  const idealDcg = dcgAtK(ideal, k)
  if (idealDcg === 0) return 0
  return dcgAtK(grades, k) / idealDcg
}

export function reciprocalRank(grades: number[]): number | null {
  if (!grades.length) return null
  const firstRelevant = grades.findIndex(grade => grade >= 2)
  return firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1)
}

export function evaluateSearchQuality(
  benchmark: SearchQualityBenchmarkCase,
  results: SearchQualityResult[],
  judgments: SearchQualityJudgment[] = [],
  currentYear = new Date().getFullYear()
): SearchQualityEvaluation {
  const topTen = results.slice(0, 10)
  const topFive = results.slice(0, 5)
  const conceptScores = topFive.map(result => conceptCoverage(result, benchmark.requiredConcepts))
  const preferredDomainHit = benchmark.preferredDomains?.length
    ? results.findIndex(result => benchmark.preferredDomains!.some(domain => matchesDomain(qualityResultDomain(result), domain)))
    : -1
  const officialHit = benchmark.expectOfficial
    ? results.findIndex(isOfficialResult)
    : -1
  const pdfHit = benchmark.expectPdf
    ? results.findIndex(isPdfResult)
    : -1
  const forbiddenTerms = (benchmark.forbiddenTerms || []).map(normalizeText).filter(Boolean)
  const judged = results.slice(0, 10).map(result => judgmentGrade(result, judgments))
  const grades = judged.map(grade => grade ?? 0)
  const judgedResultCount = judged.filter(grade => grade !== null).length

  return {
    resultCount: results.length,
    duplicateRate: duplicateRate(results),
    uniqueDomains: new Set(results.map(qualityResultDomain).filter(Boolean)).size,
    uniqueSources: new Set(results.map(result => result.source).filter(Boolean)).size,
    topResultConceptCoverage: results[0] ? conceptCoverage(results[0], benchmark.requiredConcepts) : 0,
    topFiveConceptCoverage: conceptScores.length
      ? conceptScores.reduce((total, score) => total + score, 0) / conceptScores.length
      : 0,
    preferredDomainHitRank: preferredDomainHit >= 0 ? preferredDomainHit + 1 : null,
    officialHitRank: officialHit >= 0 ? officialHit + 1 : null,
    pdfHitRank: pdfHit >= 0 ? pdfHit + 1 : null,
    staleResultRate: topTen.length
      ? topTen.filter(result => isStaleYearOnly(result, currentYear)).length / topTen.length
      : 0,
    forbiddenResultRate: topTen.length && forbiddenTerms.length
      ? topTen.filter(result => {
          const text = resultText(result)
          return forbiddenTerms.some(term => text.includes(term))
        }).length / topTen.length
      : 0,
    judgedResultCount,
    ndcgAt10: judgedResultCount ? ndcgAtK(grades, 10) : null,
    reciprocalRank: judgedResultCount ? reciprocalRank(grades) : null,
    grades,
  }
}
