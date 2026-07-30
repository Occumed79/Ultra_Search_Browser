import {
  cosineSimilarity,
  generateLocalEmbedding,
} from './embeddings'
import {
  runExternalSmartFilterPool,
  type ExternalCandidateDecision,
  type ExternalProviderAttempt,
} from './external-smart-filter'
import { evaluateIntentRelevance, intentRerankQuery } from './intent-relevance'
import { lensCompatibilityAdjustment } from './ranking-signals'
import {
  buildDeterministicSemanticIntent,
  coerceSemanticIntentPlan,
  type IntentConceptGroup,
  type SemanticIntentKind,
  type SemanticIntentPlan,
} from './semantic-intent'
import { scoreLexicalRelevance } from './semantic-search'
import type { ScrapedResult, SearchLens } from '../types/search'

export type SmartFilterStatus = 'valid' | 'uncertain' | 'rejected'
export type SmartFilterMode =
  | 'local-rules'
  | 'local-transformer'
  | 'cerebras'
  | 'groq'
  | 'cerebras+groq'

export interface SearchIntent {
  originalQuery: string
  interpretation: string
  requiredConcepts: string[]
  conceptGroups: IntentConceptGroup[]
  exclusions: string[]
  intentKind: SemanticIntentKind
  exactPhrases: string[]
  minimumRequiredMatches: number
  semanticPlan: SemanticIntentPlan
}

export interface SmartFilterDiagnostics {
  mode: SmartFilterMode
  localModelEnabled: boolean
  localModelUsed: boolean
  externalConfigured: boolean
  externalUsed: boolean
  providerAttempts: ExternalProviderAttempt[]
  candidateCount: number
  validCount: number
  uncertainCount: number
  rejectedCount: number
  displayedCount: number
  interpretation: string
  requiredConcepts: string[]
  failure?: string
}

export interface SmartFilterOptions {
  useLocalTransformer?: boolean
  useExternalProviders?: boolean
  semanticCandidateLimit?: number
  semanticIntent?: SemanticIntentPlan
}

export interface CandidateDecision {
  status: SmartFilterStatus
  relevance: number
  lexicalRelevance: number
  semanticRelevance?: number
  intentAdjustment: number
  matchedConcepts: string[]
  reason: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'what', 'when', 'where', 'which', 'who', 'with', 'you',
])

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])\.(?=[a-z0-9])/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function meaningfulTokens(value: string): string[] {
  const tokens = normalize(value)
    .split(' ')
    .filter(token => token.length >= 2 || /^\d+$/.test(token))
  const meaningful = tokens.filter(token => !STOP_WORDS.has(token))
  return unique(meaningful.length ? meaningful : tokens)
}

function protectedPhrases(query: string): string[] {
  const quoted = Array.from(query.matchAll(/["“”]([^"“”]{2,})["“”]/g))
    .map(match => normalize(match[1]))
    .filter(Boolean)

  const tokens = meaningfulTokens(query)
  const adjacentPairs: string[] = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index]
    const right = tokens[index + 1]
    if (left.length >= 4 && right.length >= 4) adjacentPairs.push(`${left} ${right}`)
  }

  return unique([...quoted, ...adjacentPairs]).slice(0, 5)
}

export function analyzeSearchIntent(
  query: string,
  lens: SearchLens = 'web',
  semanticIntent?: SemanticIntentPlan
): SearchIntent {
  const semanticPlan = semanticIntent
    ? coerceSemanticIntentPlan(semanticIntent, query, lens)
    : buildDeterministicSemanticIntent(query, lens)
  const requiredConcepts = semanticPlan.conceptGroups
    .filter(group => group.required)
    .map(group => group.label)
  return {
    originalQuery: query.trim(),
    interpretation: semanticPlan.interpretation,
    requiredConcepts,
    conceptGroups: semanticPlan.conceptGroups,
    exclusions: semanticPlan.exclusions,
    intentKind: semanticPlan.intentKind,
    exactPhrases: protectedPhrases(query),
    minimumRequiredMatches: Math.max(1, Math.ceil(requiredConcepts.length * 0.66)),
    semanticPlan,
  }
}

function candidateText(result: ScrapedResult): string {
  return normalize(`${result.title} ${result.description} ${result.url} ${result.domain}`)
}

function phraseMatches(intent: SearchIntent, result: ScrapedResult): string[] {
  const text = candidateText(result)
  return intent.exactPhrases.filter(phrase => text.includes(phrase))
}

export function classifyLocalCandidate(
  query: string,
  lens: SearchLens,
  intent: SearchIntent,
  result: ScrapedResult,
  semanticRelevance?: number
): CandidateDecision {
  const intentMatch = evaluateIntentRelevance(intent.semanticPlan, lens, result)
  const matches = intentMatch.matchedGroups.map(group => group.label)
  const phrases = phraseMatches(intent, result)
  const lexicalRelevance = scoreLexicalRelevance(intentRerankQuery(intent.semanticPlan), {
    title: result.title,
    text: `${result.title} ${result.description}`,
    url: result.url,
  })
  const normalizedSemantic = semanticRelevance === undefined
    ? undefined
    : Math.max(0, Math.min(1, semanticRelevance))
  const relevance = normalizedSemantic === undefined
    ? Math.max(lexicalRelevance, intentMatch.coverage)
    : Math.max(intentMatch.coverage, lexicalRelevance * 0.65 + normalizedSemantic * 0.35)
  const lensAdjustment = lensCompatibilityAdjustment(lens, result)
  const strongSemantic = normalizedSemantic !== undefined && normalizedSemantic >= 0.56
  const rejectedByConstraint = intentMatch.exclusionMatches.length > 0 || Boolean(intentMatch.collisionReason)
  const enoughCoverage = intentMatch.coverage >= 0.66
    && intentMatch.criticalCoverage >= 0.8
    && intentMatch.taskEvidence
  const possibleCoverage = intentMatch.coverage >= 0.42
    && intentMatch.criticalCoverage >= 0.45
    && (intentMatch.taskEvidence || strongSemantic)

  if (rejectedByConstraint) {
    return {
      status: 'rejected',
      relevance,
      lexicalRelevance,
      semanticRelevance: normalizedSemantic,
      intentAdjustment: intentMatch.adjustment,
      matchedConcepts: matches,
      reason: intentMatch.collisionReason
        ? `Rejected: ${intentMatch.collisionReason}.`
        : `Rejected because it matches an exclusion: ${intentMatch.exclusionMatches.join(', ')}.`,
    }
  }

  if (
    enoughCoverage
    && (lexicalRelevance >= 0.12 || phrases.length > 0 || strongSemantic || intentMatch.coverage >= 0.9)
    && lensAdjustment > -24
  ) {
    return {
      status: 'valid',
      relevance,
      lexicalRelevance,
      semanticRelevance: normalizedSemantic,
      intentAdjustment: intentMatch.adjustment,
      matchedConcepts: matches,
      reason: `Matches ${matches.length}/${intent.requiredConcepts.length || 1} intent groups with ${intentMatch.taskEvidenceReason}${phrases.length ? `, including “${phrases[0]}”` : ''}.`,
    }
  }

  if (
    possibleCoverage
    && (lexicalRelevance >= 0.08 || strongSemantic || intentMatch.coverage >= 0.6)
    && lensAdjustment > -28
  ) {
    return {
      status: 'uncertain',
      relevance,
      lexicalRelevance,
      semanticRelevance: normalizedSemantic,
      intentAdjustment: intentMatch.adjustment,
      matchedConcepts: matches,
      reason: `Possible match, but the snippet is missing ${intentMatch.missingGroups.map(group => group.label).join(', ') || intentMatch.taskEvidenceReason}.`,
    }
  }

  return {
    status: 'rejected',
    relevance,
    lexicalRelevance,
    semanticRelevance: normalizedSemantic,
    intentAdjustment: intentMatch.adjustment,
    matchedConcepts: matches,
    reason: matches.length
      ? `Rejected because only ${matches.length}/${intent.requiredConcepts.length || 1} required concepts matched.`
      : 'Rejected because the result does not match the meaningful concepts in the full query.',
  }
}

async function semanticScores(
  query: string,
  results: ScrapedResult[],
  limit: number
): Promise<Map<string, number>> {
  const scores = new Map<string, number>()
  const queryEmbedding = await generateLocalEmbedding(query)

  for (const result of results.slice(0, limit)) {
    const candidate = `${result.title}. ${result.description}. ${result.domain}`
    const embedding = await generateLocalEmbedding(candidate)
    const similarity = cosineSimilarity(queryEmbedding, embedding)
    scores.set(result.url, Math.max(0, Math.min(1, (similarity + 1) / 2)))
  }

  return scores
}

function mergeExternalDecision(
  local: CandidateDecision,
  external?: ExternalCandidateDecision
): CandidateDecision {
  if (!external) return local

  if (external.status === 'valid') {
    if (local.status === 'rejected' && external.relevance < 0.72) {
      return {
        ...local,
        status: 'uncertain',
        relevance: Math.max(local.relevance, external.relevance),
        reason: external.reason,
      }
    }
    return {
      ...local,
      status: 'valid',
      relevance: Math.max(local.relevance, external.relevance),
      reason: external.reason,
    }
  }

  if (external.status === 'rejected') {
    if (local.status === 'valid' && local.relevance >= 0.75) {
      return {
        ...local,
        status: 'uncertain',
        relevance: Math.max(local.relevance, external.relevance),
        reason: external.reason,
      }
    }
    return {
      ...local,
      status: 'rejected',
      relevance: Math.min(local.relevance, external.relevance),
      reason: external.reason,
    }
  }

  return {
    ...local,
    status: 'uncertain',
    relevance: Math.max(local.relevance, external.relevance),
    reason: external.reason,
  }
}

function existingExternalDecision(result: ScrapedResult): ExternalCandidateDecision | undefined {
  const validation = result.validation
  if (!validation) return undefined
  if (validation.mode === 'local-rules' || validation.mode === 'local-transformer') return undefined
  return {
    id: result.rank - 1,
    status: validation.status,
    relevance: validation.relevance,
    reason: validation.reason,
  }
}

export async function applySmartFilter(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[],
  displayLimit: number,
  options: SmartFilterOptions = {}
): Promise<{ results: ScrapedResult[]; diagnostics: SmartFilterDiagnostics }> {
  const intent = analyzeSearchIntent(query, lens, options.semanticIntent)
  const localModelEnabled = options.useLocalTransformer === true
    && process.env.DISABLE_LOCAL_SMART_FILTER !== 'true'
  let localModelUsed = false
  let localFailure: string | undefined
  let semanticByUrl = new Map<string, number>()

  if (localModelEnabled && results.length > 0) {
    try {
      semanticByUrl = await semanticScores(
        intentRerankQuery(intent.semanticPlan),
        results,
        Math.max(1, Math.min(options.semanticCandidateLimit ?? 20, results.length))
      )
      localModelUsed = semanticByUrl.size > 0
    } catch (error) {
      localFailure = error instanceof Error ? error.message : String(error)
      console.warn('Local transformer filter failed; using deterministic full-query filter:', localFailure)
    }
  }

  const localDecisions = results.map(result => classifyLocalCandidate(
    query,
    lens,
    intent,
    result,
    semanticByUrl.get(result.url)
  ))

  const external = options.useExternalProviders === true
    ? await runExternalSmartFilterPool(query, lens, intent, results, localDecisions)
    : {
        configured: Boolean(process.env.CEREBRAS_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim()),
        used: false,
        decisions: new Map<number, ExternalCandidateDecision>(),
        attempts: [] as ExternalProviderAttempt[],
      }

  const priorMode = results
    .map(result => result.validation?.mode)
    .find(mode => mode && mode !== 'local-rules' && mode !== 'local-transformer')
  const finalMode: SmartFilterMode = external.used && external.mode
    ? external.mode
    : priorMode || (localModelUsed ? 'local-transformer' : 'local-rules')
  const interpretation = external.interpretation?.trim() || intent.interpretation

  const classified = results.map((result, index) => {
    const externalDecision = external.decisions.get(index) || existingExternalDecision(result)
    const decision = mergeExternalDecision(localDecisions[index], externalDecision)
    const statusAdjustment = decision.status === 'valid'
      ? Math.round(decision.relevance * 24)
      : decision.status === 'uncertain'
        ? -8
        : -45

    return {
      ...result,
      score: result.score + decision.intentAdjustment + statusAdjustment,
      validation: {
        status: decision.status,
        relevance: Number(decision.relevance.toFixed(3)),
        reason: decision.reason,
        matchedConcepts: decision.matchedConcepts,
        mode: externalDecision ? finalMode : (localModelUsed ? 'local-transformer' as const : 'local-rules' as const),
      },
    }
  })

  const valid = classified
    .filter(result => result.validation.status === 'valid')
    .sort((left, right) => right.score - left.score)
  const uncertain = classified
    .filter(result => result.validation.status === 'uncertain')
    .sort((left, right) => right.score - left.score)
  const rejected = classified.filter(result => result.validation.status === 'rejected')

  const uncertainAllowance = Math.max(0, displayLimit - valid.length)
  let displayed = [...valid, ...uncertain.slice(0, uncertainAllowance)]

  displayed = displayed
    .slice(0, displayLimit)
    .map((result, index) => ({ ...result, rank: index + 1 }))

  const providerFailures = external.attempts
    .filter(attempt => attempt.status === 'failed')
    .map(attempt => `${attempt.provider}: ${attempt.error}`)
  const failure = [localFailure, ...providerFailures].filter(Boolean).join(' | ') || undefined

  return {
    results: displayed,
    diagnostics: {
      mode: finalMode,
      localModelEnabled,
      localModelUsed,
      externalConfigured: external.configured,
      externalUsed: external.used,
      providerAttempts: external.attempts,
      candidateCount: results.length,
      validCount: valid.length,
      uncertainCount: uncertain.length,
      rejectedCount: rejected.length,
      displayedCount: displayed.length,
      interpretation,
      requiredConcepts: intent.requiredConcepts,
      failure,
    },
  }
}
