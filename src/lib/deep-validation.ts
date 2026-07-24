import { deduplicateEntities } from './entity-dedupe'
import { extractIntelligence } from './entity-extraction'
import { pageValidationCacheStats, validateCandidatePage } from './page-validation'
import { applySmartFilter, type SmartFilterDiagnostics } from './smart-filter'
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
  }
}

export interface DeepValidationOptions {
  maxTargets?: number
  concurrency?: number
  onEvent?: (event: DeepValidationEvent) => void | Promise<void>
}

const MAX_DEEP_VALIDATION_TARGETS = 24
const VALIDATION_CONCURRENCY = 4
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
  if (['blocked', 'login', 'generic', 'search-page', 'thin', 'unsupported'].includes(page.availability)) return 'rejected'
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

export async function deepValidateResults(
  query: string,
  lens: SearchLens,
  inputResults: ScrapedResult[],
  options: DeepValidationOptions = {}
): Promise<DeepValidationOutcome> {
  const startedAt = Date.now()
  const maxTargets = Math.max(1, Math.min(options.maxTargets ?? MAX_DEEP_VALIDATION_TARGETS, 30))
  const concurrency = Math.max(1, Math.min(options.concurrency ?? VALIDATION_CONCURRENCY, 6))
  const targets = inputResults.slice(0, maxTargets)
  const remainder = inputResults.slice(maxTargets)
  const progress = initialProgress(targets.length)

  const emit = async (event: DeepValidationEvent) => {
    await options.onEvent?.(event)
  }

  const validated = await mapWithConcurrency(targets, concurrency, async result => {
    const page = await validateCandidatePage(result, lens, query)
    progress.checked += 1
    if (page.availability === 'reachable') progress.reachable += 1
    if (page.availability === 'dead') progress.dead += 1
    else if (page.availability !== 'reachable' && page.availability !== 'error') progress.rejected += 1

    const enriched: ScrapedResult = {
      ...result,
      url: page.finalUrl || result.url,
      title: page.title || result.title,
      content: page.extractedText.slice(0, 24_000),
      intelligence: page.extractedText
        ? extractIntelligence(page.extractedText, page.finalUrl || result.url, page.title || result.title, lens)
        : result.intelligence,
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
    }

    await emit({ type: 'result', progress: { ...progress }, result: publicResult(enriched) })
    await emit({ type: 'progress', progress: { ...progress } })
    return enriched
  })

  progress.phase = 'reviewing-evidence'
  await emit({ type: 'progress', progress: { ...progress } })

  const reviewable = validated.filter(result => !lifecycleBucket(result) && result.pageValidation?.availability === 'reachable')
  let smartDiagnostics = EMPTY_SMART_DIAGNOSTICS
  let reviewedByUrl = new Map<string, ScrapedResult>()

  if (reviewable.length > 0) {
    const smart = await applySmartFilter(query, lens, reviewable, reviewable.length, {
      useLocalTransformer: true,
      useExternalProviders: true,
      semanticCandidateLimit: Math.min(16, reviewable.length),
    })
    smartDiagnostics = smart.diagnostics
    reviewedByUrl = new Map(smart.results.map(result => [result.url, result]))
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

    if (original.pageValidation?.availability === 'error') {
      buckets.uncertain.push(bucketResult({
        ...original,
        validation: {
          status: 'uncertain',
          relevance: original.validation?.relevance || 0,
          reason: original.pageValidation.reason,
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
        'The destination page did not pass the complete-query evidence review.'
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
        reason: `Not opened because the deep-validation budget was capped at ${maxTargets} pages.`,
        matchedConcepts: result.validation?.matchedConcepts || [],
        mode: result.validation?.mode || 'local-rules',
      },
    }, 'uncertain'))
  }

  progress.phase = 'deduplicating'
  await emit({ type: 'progress', progress: { ...progress } })
  const displayable = [...buckets.valid, ...buckets.uncertain]
  const deduped = deduplicateEntities(displayable, lens)
  buckets.duplicate.push(...deduped.duplicates.map(result => bucketResult(result, 'duplicate')))
  buckets.valid = deduped.results.filter(result => result.bucket === 'valid' || result.validation?.status === 'valid')
    .map(result => bucketResult(result, 'valid'))
  buckets.uncertain = deduped.results.filter(result => result.validation?.status !== 'valid')
    .map(result => bucketResult(result, 'uncertain'))

  for (const key of Object.keys(buckets) as ResultBucket[]) {
    buckets[key].sort((left, right) => right.score - left.score)
    buckets[key] = buckets[key].map((result, index) => ({ ...result, rank: index + 1 }))
  }

  progress.phase = 'complete'
  progress.valid = buckets.valid.length
  progress.uncertain = buckets.uncertain.length
  progress.expired = buckets.expired.length
  progress.dead = buckets.dead.length
  progress.rejected = buckets.rejected.length
  progress.duplicates = buckets.duplicate.length

  const results = buckets.valid.length > 0 ? buckets.valid : buckets.uncertain.slice(0, 5)
  const outcome: DeepValidationOutcome = {
    results,
    buckets,
    progress: { ...progress },
    diagnostics: {
      runtimeMs: Date.now() - startedAt,
      validationTargets: targets.length,
      pageCache: pageValidationCacheStats(),
      smartFilter: smartDiagnostics,
      duplicateCount: deduped.duplicateCount,
    },
  }
  await emit({ type: 'complete', progress: { ...progress } })
  return outcome
}
