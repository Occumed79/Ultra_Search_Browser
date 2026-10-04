import { buildBrowserSearchPlan, normalizeBrowserSerpCandidates, type BrowserSearchPlan } from './browser-search-pipeline'
import { deepValidateResults, type DeepValidationOptions, type DeepValidationOutcome } from './deep-validation'
import { applyCanonicalDecisionGate } from './canonical-result-decision'
import { deduplicateSolicitations } from './solicitation-dedupe'
import { executeSearchRetrieval } from './search-retrieval'
import { recordSearchFlightStage } from './search-flight-recorder'
import { canonicalRetrievalUrl } from './search-retrieval-coverage'
import {
  normalizeResearchQuery, planAdaptiveResearch, researchNovelty, researchSnapshot, RESEARCH_LIMITS,
} from './adaptive-research-planner'
import type { ScrapedResult, SearchResultBuckets } from '../types/search'

export interface ResearchWaveDiagnostic {
  wave: number
  queries: BrowserSearchPlan['searches']
  gaps: string[]
  providerCalls: number
  candidates: number
  newCandidates: number
  novelty: ReturnType<typeof researchNovelty>
  retrievalDiagnostics: Awaited<ReturnType<typeof executeSearchRetrieval>>['diagnostics']
}
export interface AdaptiveResearchDiagnostics {
  wavesCompleted: number
  stopReason: 'wave-cap' | 'no-novelty' | 'no-followup-queries' | 'time-budget' | 'page-budget' | 'cancelled' | 'followup-failed'
  executedQueries: string[]
  waves: ResearchWaveDiagnostic[]
  error?: string
}
export type ResearchOutcome = DeepValidationOutcome & { diagnostics: DeepValidationOutcome['diagnostics'] & { adaptiveResearch: AdaptiveResearchDiagnostics } }

/** Apply existing solicitation dedupe and the canonical gate across waves, retaining all lifecycle buckets. */
export function mergeResearchOutcomes(previous: DeepValidationOutcome, next: DeepValidationOutcome): DeepValidationOutcome {
  const deduped = deduplicateSolicitations([...previous.results, ...next.results])
  const buckets: SearchResultBuckets = {
    valid: deduped.results.filter(result => result.validation?.status === 'valid'),
    uncertain: deduped.results.filter(result => result.validation?.status !== 'valid'),
    expired: [...previous.buckets.expired, ...next.buckets.expired],
    dead: [...previous.buckets.dead, ...next.buckets.dead],
    rejected: [...previous.buckets.rejected, ...next.buckets.rejected],
    duplicate: [...previous.buckets.duplicate, ...next.buckets.duplicate, ...deduped.duplicates],
  }
  const merged = {
    ...previous, results: deduped.results, buckets,
    progress: { ...previous.progress, checked: previous.progress.checked + next.progress.checked, reachable: previous.progress.reachable + next.progress.reachable, total: previous.progress.total + next.progress.total },
    diagnostics: { ...previous.diagnostics, runtimeMs: previous.diagnostics.runtimeMs + next.diagnostics.runtimeMs, validationTargets: previous.diagnostics.validationTargets + next.diagnostics.validationTargets, duplicateCount: buckets.duplicate.length },
  }
  return applyCanonicalDecisionGate(merged)
}
interface ResearchOptions {
  executedQueries?: string[]
  traceId?: string
  deadline?: number
  signal?: AbortSignal
  validation?: DeepValidationOptions
}
interface ResearchDependencies {
  retrieve: typeof executeSearchRetrieval
  validate: typeof deepValidateResults
  now: () => number
}

/** Wave one is supplied by the existing retrieval/validation flow. Waves two/three are evidence-driven only. */
export async function continueAdaptiveResearch(query: string, initial: DeepValidationOutcome, options: ResearchOptions = {}, dependencies: Partial<ResearchDependencies> = {}): Promise<ResearchOutcome> {
  const retrieve = dependencies.retrieve || executeSearchRetrieval
  const validate = dependencies.validate || deepValidateResults
  const now = dependencies.now || Date.now
  const deadline = options.deadline ?? now() + RESEARCH_LIMITS.budgetMs
  const base = buildBrowserSearchPlan(query, 12, options.validation?.semanticIntent)
  const executed = new Set((options.executedQueries || base.searches.map(search => search.query)).slice(0, 60).map(normalizeResearchQuery))
  let outcome = initial
  let snapshot = researchSnapshot(Object.values(initial.buckets).flat())
  const diagnostics: AdaptiveResearchDiagnostics = { wavesCompleted: 1, stopReason: 'wave-cap', executedQueries: [...executed], waves: [] }
  for (let wave = 2; wave <= RESEARCH_LIMITS.waves; wave += 1) {
    if (options.signal?.aborted) { diagnostics.stopReason = 'cancelled'; break }
    // Reserve enough time for bounded provider rescue and complete-package validation, plus final persistence.
    if (deadline - now() < 45_000) { diagnostics.stopReason = 'time-budget'; break }
    const remainingPages = RESEARCH_LIMITS.validationTargets - outcome.diagnostics.validationTargets
    if (remainingPages <= 0) { diagnostics.stopReason = 'page-budget'; break }
    const planned = planAdaptiveResearch(query, Object.values(outcome.buckets).flat(), executed, wave)
    if (!planned.searches.length) { diagnostics.stopReason = 'no-followup-queries'; break }
    planned.searches.forEach(search => executed.add(normalizeResearchQuery(search.query)))
    const plan = { ...base, searches: planned.searches, traceId: options.traceId }
    recordSearchFlightStage(options.traceId, 'research.wave-start', { wave, queries: planned.searches, gaps: planned.gaps })
    try {
      const batch = await retrieve(plan, { adaptive: true, wave, signal: options.signal, deadline })
      if (options.signal?.aborted) { diagnostics.stopReason = 'cancelled'; break }
      const seen = new Set(Object.values(outcome.buckets).flat().filter(result => result.pageValidation).flatMap(result => [result.url, result.pageValidation?.requestedUrl || '', ...(result.entity?.alternateUrls || [])]).map(canonicalRetrievalUrl).filter(Boolean))
      const normalized = normalizeBrowserSerpCandidates(batch.results)
      const fresh = normalized.filter(result => !seen.has(canonicalRetrievalUrl(result.url)))
      // Preserve discovery provenance for repeat URLs without fetching or upgrading them.
      const repeats = new Map(normalized.filter(result => seen.has(canonicalRetrievalUrl(result.url))).map(result => [canonicalRetrievalUrl(result.url), result]))
      for (const result of Object.values(outcome.buckets).flat()) {
        const repeat = repeats.get(canonicalRetrievalUrl(result.pageValidation?.requestedUrl || result.url))
        if (repeat && result.retrieval) result.retrieval = { ...result.retrieval,
          queries: [...new Set([...result.retrieval.queries, ...(repeat.retrieval?.queries || [])])],
          purposes: [...new Set([...result.retrieval.purposes, ...(repeat.retrieval?.purposes || [])])],
          research: [...(result.retrieval.research || []), ...(repeat.retrieval?.research || [])],
        }
      }
      if (fresh.length && deadline - now() > 15_000) {
        // Split remaining page budget over both possible waves; no growing candidate-pool validation.
        const maxTargets = Math.min(RESEARCH_LIMITS.pagesPerWave, Math.ceil(remainingPages / (RESEARCH_LIMITS.waves - wave + 1)))
        const validated = await validate(query, 'procurement', fresh.slice(0, maxTargets), { ...options.validation, maxTargets, pageTimeoutMs: 8_000, deadline, signal: options.signal })
        outcome = mergeResearchOutcomes(outcome, validated)
      } else if (fresh.length) { diagnostics.stopReason = 'time-budget' }
      const current = researchSnapshot(Object.values(outcome.buckets).flat())
      const novelty = researchNovelty(snapshot, current)
      const detail: ResearchWaveDiagnostic = { wave, queries: planned.searches, gaps: planned.gaps, providerCalls: batch.providerCalls, candidates: batch.results.length, newCandidates: fresh.length, novelty, retrievalDiagnostics: batch.diagnostics }
      diagnostics.waves.push(detail)
      diagnostics.wavesCompleted = wave
      recordSearchFlightStage(options.traceId, 'research.wave-complete', detail as unknown as Record<string, unknown>)
      snapshot = current
      if (diagnostics.stopReason === 'time-budget') break
      if (!novelty.meaningful) { diagnostics.stopReason = 'no-novelty'; break }
    } catch (error) {
      diagnostics.stopReason = options.signal?.aborted ? 'cancelled' : 'followup-failed'
      diagnostics.error = error instanceof Error ? error.message : String(error)
      break // Preserve the already validated first wave when optional discovery fails.
    }
  }
  diagnostics.executedQueries = [...executed]
  recordSearchFlightStage(options.traceId, 'research.complete', diagnostics as unknown as Record<string, unknown>)
  return { ...outcome, diagnostics: { ...outcome.diagnostics, adaptiveResearch: diagnostics } }
}
