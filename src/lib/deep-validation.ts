import { deduplicateEntities } from './entity-dedupe'
import { extractIntelligence } from './entity-extraction'
import { pageValidationCacheStats, validateCandidatePage } from './page-validation'
import type { SemanticIntentPlan } from './semantic-intent'
import { applyOccuMedSmartFilter, type SmartFilterDiagnostics } from './occumed-smart-filter'
import { structuredRfpReviewText, type RfpOpportunityIntelligence } from './rfp-opportunity-intelligence'
import { deduplicateSolicitations } from './solicitation-dedupe'
import type { SolicitationPackageAnalysis } from './solicitation-package'
import type {
  ResultBucket,
  ScrapedResult,
  SearchLens,
  SearchResultBuckets,
  SearchValidationProgress,
} from '../types/search'

export interface DeepValidationEvent {
  type: 'progress' | 'result' | 'complete'
  progress: SearchValidationProgress
  result?: ScrapedResult
}

export interface AdaptiveValidationDiagnostics {
  candidatePool: number
  prioritizedCandidates: number
  waveSize: number
  wavesCompleted: number
  likelyShowTarget: number
  likelyShowCount: number
  stopReason: 'show-target-reached' | 'target-cap-reached' | 'pool-exhausted'
}

export interface DeepValidationOutcome {
  results: ScrapedResult[]
  buckets: SearchResultBuckets
  progress: SearchValidationProgress
  diagnostics: {
    runtimeMs: number
    validationTargets: number
    pageCache: ReturnType<typeof pageValidationCacheStats>
    smartFilter: SmartFilterDiagnostics
    duplicateCount: number
    adaptiveValidation: AdaptiveValidationDiagnostics
  }
}

export interface DeepValidationOptions {
  maxTargets?: number
  concurrency?: number
  onEvent?: (event: DeepValidationEvent) => void | Promise<void>
  semanticIntent?: SemanticIntentPlan
}

type EnrichedRfpResult = ScrapedResult & {
  rfpIntelligence?: RfpOpportunityIntelligence
  packageAnalysis?: SolicitationPackageAnalysis
}

const MAX_DEEP_VALIDATION_TARGETS = 48
const VALIDATION_CONCURRENCY = 4
const VALIDATION_WAVE_SIZE = 12
const LIKELY_SHOW_TARGET = 10
const EMPTY_SMART_DIAGNOSTICS: SmartFilterDiagnostics = {
  mode: 'local-rules',
  localModelEnabled: false,
  localModelUsed: false,
  externalConfigured: false,
  externalUsed: false,
  providerAttempts: [],
  candidateCount: 0,
  validCount: 0,
  uncertainCount: 0,
  rejectedCount: 0,
  displayedCount: 0,
  interpretation: '',
  requiredConcepts: [],
}

function emptyBuckets(): SearchResultBuckets {
  return { valid: [], uncertain: [], expired: [], dead: [], rejected: [], duplicate: [] }
}

function initialProgress(total: number): SearchValidationProgress {
  return {
    phase: 'opening-pages',
    total,
    checked: 0,
    reachable: 0,
    valid: 0,
    uncertain: 0,
    expired: 0,
    dead: 0,
    rejected: 0,
    duplicates: 0,
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  async function run() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, () => run()))
  return output
}

function extractionType(contentType: string | undefined, url: string): string {
  const normalized = `${contentType || ''} ${url}`.toLowerCase()
  if (normalized.includes('pdf')) return 'pdf'
  if (normalized.includes('wordprocessingml') || normalized.includes('.docx')) return 'docx'
  return 'html'
}

function lifecycleBucket(result: ScrapedResult): ResultBucket | undefined {
  const page = result.pageValidation
  if (!page) return undefined
  if (page.availability === 'dead') return 'dead'
  if (['generic', 'search-page', 'thin'].includes(page.availability)) return 'rejected'
  if (['expired', 'closed', 'cancelled', 'awarded', 'stale'].includes(page.lifecycle.status)) return 'expired'
  return undefined
}

function publicResult(result: ScrapedResult): ScrapedResult {
  const { content: _content, ...safe } = result
  return safe
}

function rejectedByEvidence(result: ScrapedResult, reason: string): ScrapedResult {
  return {
    ...result,
    bucket: 'rejected',
    validation: {
      status: 'rejected',
      relevance: 0,
      reason,
      matchedConcepts: result.validation?.matchedConcepts || [],
      mode: result.validation?.mode || 'local-rules',
    },
  }
}

function bucketResult(result: ScrapedResult, bucket: ResultBucket): ScrapedResult {
  return publicResult({ ...result, bucket })
}

function validationPriority(result: ScrapedResult): number {
  const text = `${result.title} ${result.description} ${result.url}`
  let priority = Number.isFinite(result.score) ? result.score : 0
  if (/\.pdf(?:$|[?#])/i.test(result.url)) priority += 20
  if (/\.gov(?:\/|$)/i.test(result.url)) priority += 18
  if (/\b(?:rfp|rfq|rfi|ifb|solicitation|request for proposals?|sources sought)\b/i.test(text)) priority += 14
  if (/\b(?:occupational health|medical surveillance|fitness for duty|medical readiness|employment physical)\b/i.test(text)) priority += 12
  priority += Math.min(16, Math.max(0, (result.retrieval?.overlap || 1) - 1) * 4)
  if (/\b(?:award notice|bid tabulation|closed|archived|cancelled)\b/i.test(text)) priority -= 25
  return priority
}

function prioritizedCandidates(results: ScrapedResult[]): ScrapedResult[] {
  return [...results].sort((left, right) => validationPriority(right) - validationPriority(left))
}

function likelyShowCandidate(result: EnrichedRfpResult): boolean {
  const page = result.pageValidation
  const intelligence = result.rfpIntelligence
  if (!page || page.availability !== 'reachable' || !intelligence) return false
  if (!['open', 'active'].includes(page.lifecycle.status)) return false
  if (!['strong', 'good'].includes(intelligence.fitBand)) return false
  if (intelligence.matchedCapabilities.length === 0) return false
  if (intelligence.concerns.some(concern => /(?:equipment purchase|health insurance|general nursing staffing|patient treatment|information technology system)/i.test(concern))) return false
  return true
}

function evidenceReviewCandidate(result: EnrichedRfpResult): ScrapedResult {
  const page = result.pageValidation
  const evidence = page?.evidence?.join(' ') || ''
  const lifecycle = page
    ? `Page availability: ${page.availability}. Lifecycle status: ${page.lifecycle.status}. ${page.lifecycle.reason}`
    : ''
  const structured = result.rfpIntelligence ? structuredRfpReviewText(result.rfpIntelligence) : ''
  const pageContent = result.content || ''
  return {
    ...result,
    // External reviewers receive the structured opportunity record first, then
    // page/package evidence. This prevents a short search snippet from defining
    // the decision after the actual solicitation has been opened.
    description: [structured, result.description, lifecycle, evidence, pageContent]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 16_000),
  }
}

export async function deepValidateResults(
  query: string,
  lens: SearchLens,
  inputResults: ScrapedResult[],
  options: DeepValidationOptions = {}
): Promise<DeepValidationOutcome> {
  const startedAt = Date.now()
  const maxTargets = Math.max(1, Math.min(options.maxTargets ?? MAX_DEEP_VALIDATION_TARGETS, 60))
  const concurrency = Math.max(1, Math.min(options.concurrency ?? VALIDATION_CONCURRENCY, 6))
  const ordered = prioritizedCandidates(inputResults)
  const targetPool = ordered.slice(0, maxTargets)
  const beyondTargetCap = ordered.slice(maxTargets)
  const progress = initialProgress(targetPool.length)

  const emit = async (event: DeepValidationEvent) => {
    await options.onEvent?.(event)
  }

  const validated: EnrichedRfpResult[] = []
  let wavesCompleted = 0
  let likelyShowCount = 0
  let stopReason: AdaptiveValidationDiagnostics['stopReason'] = targetPool.length < inputResults.length
    ? 'target-cap-reached'
    : 'pool-exhausted'

  for (let waveStart = 0; waveStart < targetPool.length; waveStart += VALIDATION_WAVE_SIZE) {
    const wave = targetPool.slice(waveStart, waveStart + VALIDATION_WAVE_SIZE)
    const waveResults = await mapWithConcurrency(wave, concurrency, async (result, waveIndex) => {
      const page = await validateCandidatePage(result, lens, query, {
        // Complete-package inspection remains enabled for every adaptively
        // selected candidate. Validation stops once enough likely SHOW records
        // exist, rather than skipping the best result because it ranked 25th.
        inspectPackage: lens === 'procurement',
      })
      progress.checked += 1
      if (page.availability === 'reachable') progress.reachable += 1
      if (page.availability === 'dead') progress.dead += 1
      else if (page.availability !== 'reachable' && page.availability !== 'error') progress.rejected += 1

      const enriched = {
        ...result,
        url: page.finalUrl || result.url,
        title: page.rfpIntelligence?.title || page.title || result.title,
        content: page.extractedText.slice(0, 48_000),
        intelligence: page.extractedText
          ? extractIntelligence(page.extractedText, page.finalUrl || result.url, page.title || result.title, lens)
          : result.intelligence,
        rfpIntelligence: page.rfpIntelligence,
        packageAnalysis: page.packageAnalysis,
        extractionDiagnostics: {
          extractionAttempted: true,
          extractionSucceeded: page.extractedTextLength > 0,
          extractionType: extractionType(page.contentType, page.finalUrl),
          extractedTextLength: page.extractedTextLength,
          extractionError: page.extractedTextLength > 0 ? undefined : page.reason,
        },
        pageValidation: {
          checkedAt: page.checkedAt,
          requestedUrl: page.requestedUrl,
          finalUrl: page.finalUrl,
          httpStatus: page.httpStatus,
          contentType: page.contentType,
          availability: page.availability,
          reason: page.reason,
          evidence: page.evidence,
          extractedTextLength: page.extractedTextLength,
          contentHash: page.contentHash,
          cached: page.cached,
          lifecycle: page.lifecycle,
        },
      } as EnrichedRfpResult

      await emit({ type: 'result', progress: { ...progress }, result: publicResult(enriched) })
      await emit({ type: 'progress', progress: { ...progress } })
      return enriched
    })

    validated.push(...waveResults)
    wavesCompleted += 1
    likelyShowCount = validated.filter(likelyShowCandidate).length
    if (likelyShowCount >= LIKELY_SHOW_TARGET) {
      stopReason = 'show-target-reached'
      break
    }
  }

  const validatedUrls = new Set(validated.map(result => result.pageValidation?.requestedUrl || result.url))
  const adaptiveRemainder = targetPool.filter(result => !validatedUrls.has(result.url))
  const remainder = [...adaptiveRemainder, ...beyondTargetCap]

  progress.phase = 'reviewing-evidence'
  await emit({ type: 'progress', progress: { ...progress } })

  const reviewable = validated.filter(result => !lifecycleBucket(result) && result.pageValidation?.availability === 'reachable')
  let smartDiagnostics = { ...EMPTY_SMART_DIAGNOSTICS, interpretation: query }
  let reviewedByUrl = new Map<string, ScrapedResult>()

  if (reviewable.length > 0) {
    const smart = await applyOccuMedSmartFilter(
      query,
      lens,
      reviewable.map(evidenceReviewCandidate),
      reviewable.length,
      {
        useLocalTransformer: true,
        useExternalProviders: true,
        semanticCandidateLimit: Math.min(24, reviewable.length),
        semanticIntent: options.semanticIntent,
      }
    )
    smartDiagnostics = smart.diagnostics
    const originalByUrl = new Map(reviewable.map(result => [result.url, result]))
    reviewedByUrl = new Map(smart.results.map(reviewed => {
      const original = originalByUrl.get(reviewed.url) || reviewed
      return [reviewed.url, {
        ...original,
        score: reviewed.score,
        validation: reviewed.validation,
      }]
    }))
  }

  const buckets = emptyBuckets()
  for (const original of validated) {
    const forcedBucket = lifecycleBucket(original)
    if (forcedBucket) {
      const forced = bucketResult(
        forcedBucket === 'rejected'
          ? rejectedByEvidence(original, original.pageValidation?.reason || 'The destination did not provide substantive public evidence.')
          : original,
        forcedBucket
      )
      buckets[forcedBucket].push(forced)
      continue
    }

    if (['blocked', 'login', 'unsupported', 'error'].includes(original.pageValidation?.availability || '')) {
      buckets.uncertain.push(bucketResult({
        ...original,
        validation: {
          status: 'uncertain',
          relevance: original.validation?.relevance || 0,
          reason: `The result remains outside the primary list because its destination could not be independently verified: ${original.pageValidation?.reason || 'page access was unavailable'}`,
          matchedConcepts: original.validation?.matchedConcepts || [],
          mode: original.validation?.mode || 'local-rules',
        },
      }, 'uncertain'))
      continue
    }

    const reviewed = reviewedByUrl.get(original.url)
    if (!reviewed) {
      buckets.rejected.push(bucketResult(rejectedByEvidence(
        original,
        'The destination page and solicitation package did not pass the complete-query and Occu-Med capability evidence review.'
      ), 'rejected'))
      continue
    }

    const bucket: ResultBucket = reviewed.validation?.status === 'valid'
      ? 'valid'
      : reviewed.validation?.status === 'uncertain'
        ? 'uncertain'
        : 'rejected'
    buckets[bucket].push(bucketResult(reviewed, bucket))
  }

  for (const result of remainder) {
    buckets.uncertain.push(bucketResult({
      ...result,
      validation: {
        status: 'uncertain',
        relevance: result.validation?.relevance || 0,
        reason: stopReason === 'show-target-reached'
          ? `Not opened because adaptive validation already found ${likelyShowCount} likely SHOW opportunities.`
          : `Not opened because the adaptive validation cap was ${maxTargets} pages.`,
        matchedConcepts: result.validation?.matchedConcepts || [],
        mode: result.validation?.mode || 'local-rules',
      },
    }, 'uncertain'))
  }

  progress.phase = 'deduplicating'
  await emit({ type: 'progress', progress: { ...progress } })
  const displayable = [...buckets.valid, ...buckets.uncertain]
  const deduped = lens === 'procurement'
    ? deduplicateSolicitations(displayable)
    : deduplicateEntities(displayable, lens)
  buckets.duplicate.push(...deduped.duplicates.map(result => bucketResult(result, 'duplicate')))
  buckets.valid = deduped.results.filter(result => result.validation?.status === 'valid')
    .map(result => bucketResult(result, 'valid'))
  buckets.uncertain = deduped.results.filter(result => result.validation?.status !== 'valid')
    .map(result => bucketResult(result, 'uncertain'))

  for (const key of Object.keys(buckets) as ResultBucket[]) {
    buckets[key].sort((left, right) => right.score - left.score)
    buckets[key] = buckets[key].map((result, index) => ({ ...result, rank: index + 1 }))
  }

  progress.phase = 'complete'
  progress.total = validated.length
  progress.valid = buckets.valid.length
  progress.uncertain = buckets.uncertain.length
  progress.expired = buckets.expired.length
  progress.dead = buckets.dead.length
  progress.rejected = buckets.rejected.length
  progress.duplicates = buckets.duplicate.length

  const results = [...buckets.valid, ...buckets.uncertain]
    .sort((left, right) => right.score - left.score)
    .map((result, index) => ({ ...result, rank: index + 1 }))
  const outcome: DeepValidationOutcome = {
    results,
    buckets,
    progress: { ...progress },
    diagnostics: {
      runtimeMs: Date.now() - startedAt,
      validationTargets: validated.length,
      pageCache: pageValidationCacheStats(),
      smartFilter: smartDiagnostics,
      duplicateCount: deduped.duplicateCount,
      adaptiveValidation: {
        candidatePool: inputResults.length,
        prioritizedCandidates: targetPool.length,
        waveSize: VALIDATION_WAVE_SIZE,
        wavesCompleted,
        likelyShowTarget: LIKELY_SHOW_TARGET,
        likelyShowCount,
        stopReason,
      },
    },
  }
  await emit({ type: 'complete', progress: { ...progress } })
  return outcome
}
