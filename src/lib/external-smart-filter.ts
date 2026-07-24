import type { ScrapedResult, SearchLens } from '../types/search'

export type ExternalSmartFilterProvider = 'cerebras' | 'groq'
export type ExternalDecisionStatus = 'valid' | 'uncertain' | 'rejected'

export interface ExternalCandidateDecision {
  id: number
  status: ExternalDecisionStatus
  relevance: number
  reason: string
}

export interface ExternalProviderAttempt {
  provider: ExternalSmartFilterProvider
  model: string
  status: 'success' | 'failed' | 'skipped'
  runtimeMs: number
  candidateCount: number
  error?: string
}

export interface ExternalSmartFilterOutcome {
  configured: boolean
  used: boolean
  mode?: 'cerebras' | 'groq' | 'cerebras+groq'
  interpretation?: string
  decisions: Map<number, ExternalCandidateDecision>
  attempts: ExternalProviderAttempt[]
}

export interface ExternalIntent {
  originalQuery: string
  interpretation: string
  requiredConcepts: string[]
  exactPhrases: string[]
  minimumRequiredMatches: number
}

export interface LocalDecisionSummary {
  status: ExternalDecisionStatus
  relevance: number
  matchedConcepts: string[]
}

interface ProviderConfig {
  provider: ExternalSmartFilterProvider
  apiKey: string
  endpoint: string
  model: string
}

interface ProviderPayload {
  interpretation?: string
  decisions?: Array<{
    id?: unknown
    status?: unknown
    relevance?: unknown
    reason?: unknown
  }>
}

interface ProviderResult {
  interpretation: string
  decisions: Map<number, ExternalCandidateDecision>
}

const PROVIDER_TIMEOUT_MS = 5_000
const MAX_PRIMARY_CANDIDATES = 30
const MAX_REVIEW_CANDIDATES = 12

function providerConfigs(): ProviderConfig[] {
  const providers: ProviderConfig[] = []
  const cerebrasKey = process.env.CEREBRAS_API_KEY?.trim()
  const groqKey = process.env.GROQ_API_KEY?.trim()

  if (cerebrasKey) {
    providers.push({
      provider: 'cerebras',
      apiKey: cerebrasKey,
      endpoint: 'https://api.cerebras.ai/v1/chat/completions',
      model: process.env.CEREBRAS_SMART_MODEL?.trim() || 'gpt-oss-120b',
    })
  }

  if (groqKey) {
    providers.push({
      provider: 'groq',
      apiKey: groqKey,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_SMART_MODEL?.trim()
        || process.env.GROQ_REVIEW_MODEL?.trim()
        || 'openai/gpt-oss-20b',
    })
  }

  return providers
}

export function externalSmartFilterCapabilities() {
  return {
    cerebras: {
      configured: Boolean(process.env.CEREBRAS_API_KEY?.trim()),
      model: process.env.CEREBRAS_SMART_MODEL?.trim() || 'gpt-oss-120b',
    },
    groq: {
      configured: Boolean(process.env.GROQ_API_KEY?.trim()),
      model: process.env.GROQ_SMART_MODEL?.trim()
        || process.env.GROQ_REVIEW_MODEL?.trim()
        || 'openai/gpt-oss-20b',
    },
  }
}

function responseSchema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'search_result_filter',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          interpretation: { type: 'string' },
          decisions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'integer' },
                status: { type: 'string', enum: ['valid', 'uncertain', 'rejected'] },
                relevance: { type: 'number', minimum: 0, maximum: 1 },
                reason: { type: 'string' },
              },
              required: ['id', 'status', 'relevance', 'reason'],
            },
          },
        },
        required: ['interpretation', 'decisions'],
      },
    },
  }
}

function supportsStrictSchema(config: ProviderConfig): boolean {
  return config.provider === 'cerebras' || config.model.includes('gpt-oss')
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

export function parseProviderPayload(value: string, allowedIds: Set<number>): ProviderResult {
  const payload = JSON.parse(stripJsonFence(value)) as ProviderPayload
  const decisions = new Map<number, ExternalCandidateDecision>()

  for (const raw of Array.isArray(payload.decisions) ? payload.decisions : []) {
    const id = Number(raw.id)
    const status = raw.status
    const relevance = Number(raw.relevance)
    if (!Number.isInteger(id) || !allowedIds.has(id)) continue
    if (status !== 'valid' && status !== 'uncertain' && status !== 'rejected') continue
    if (!Number.isFinite(relevance)) continue

    decisions.set(id, {
      id,
      status,
      relevance: Math.max(0, Math.min(1, relevance)),
      reason: typeof raw.reason === 'string' && raw.reason.trim()
        ? raw.reason.trim().slice(0, 400)
        : 'Provider classification supplied no explanation.',
    })
  }

  return {
    interpretation: typeof payload.interpretation === 'string' ? payload.interpretation.trim() : '',
    decisions,
  }
}

function promptForCandidates(
  query: string,
  lens: SearchLens,
  intent: ExternalIntent,
  results: ScrapedResult[],
  candidateIds: number[],
  localDecisions: LocalDecisionSummary[]
): string {
  const candidates = candidateIds.map(id => {
    const result = results[id]
    return {
      id,
      title: result.title.slice(0, 240),
      url: result.url.slice(0, 500),
      snippet: result.description.slice(0, 800),
      source: result.source,
      localStatus: localDecisions[id]?.status,
      localRelevance: localDecisions[id]?.relevance,
      locallyMatchedConcepts: localDecisions[id]?.matchedConcepts,
    }
  })

  return JSON.stringify({
    query,
    lens,
    interpretation: intent.interpretation,
    requiredConcepts: intent.requiredConcepts,
    protectedPhrases: intent.exactPhrases,
    minimumRequiredMatches: intent.minimumRequiredMatches,
    candidates,
  })
}

async function callProvider(
  config: ProviderConfig,
  query: string,
  lens: SearchLens,
  intent: ExternalIntent,
  results: ScrapedResult[],
  candidateIds: number[],
  localDecisions: LocalDecisionSummary[]
): Promise<ProviderResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  const strictSchema = supportsStrictSchema(config)
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    max_completion_tokens: 5_000,
    messages: [
      {
        role: 'system',
        content: [
          'You are the relevance gate inside a metasearch super-filter.',
          'Judge each candidate against the user’s complete intent, not one isolated keyword.',
          'VALID means the title, URL, and snippet provide strong evidence that the page answers the full query.',
          'UNCERTAIN means the page may answer it but the supplied evidence is incomplete.',
          'REJECTED means irrelevant, a generic homepage, a wrong word meaning, a job/product collision, junk, an aggregator with no substantive answer, or visibly closed/expired/archived.',
          'Never invent page contents, dates, or status. Use only the supplied candidate evidence.',
          'Return one decision for every supplied candidate ID.',
          'Respond only with JSON matching the requested structure.',
        ].join(' '),
      },
      {
        role: 'user',
        content: promptForCandidates(query, lens, intent, results, candidateIds, localDecisions),
      },
    ],
    response_format: strictSchema ? responseSchema() : { type: 'json_object' },
  }

  if (config.model.includes('gpt-oss')) body.reasoning_effort = 'low'

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(config.provider === 'cerebras' ? { 'X-Cerebras-Version-Patch': '2' } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`)
    }

    const envelope = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    }
    const content = envelope.choices?.[0]?.message?.content
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map(part => part.text || '').join('')
        : ''
    if (!text.trim()) throw new Error('Provider returned no message content')

    const allowedIds = new Set(candidateIds)
    const parsed = parseProviderPayload(text, allowedIds)
    const minimumCoverage = Math.max(1, Math.ceil(candidateIds.length * 0.7))
    if (parsed.decisions.size < minimumCoverage) {
      throw new Error(`Provider classified ${parsed.decisions.size}/${candidateIds.length} candidates`)
    }
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

export function mergeProviderDecisions(
  primary: ExternalCandidateDecision,
  reviewer?: ExternalCandidateDecision
): ExternalCandidateDecision {
  if (!reviewer) return primary
  if (primary.status === reviewer.status) {
    return {
      ...primary,
      relevance: Number(((primary.relevance + reviewer.relevance) / 2).toFixed(3)),
      reason: reviewer.reason || primary.reason,
    }
  }
  if (primary.status === 'uncertain') return reviewer
  if (reviewer.status === 'uncertain') return primary

  return {
    id: primary.id,
    status: 'uncertain',
    relevance: Number(((primary.relevance + reviewer.relevance) / 2).toFixed(3)),
    reason: `Cerebras and Groq disagreed. Cerebras: ${primary.reason} Groq: ${reviewer.reason}`.slice(0, 400),
  }
}

function needsReview(
  external: ExternalCandidateDecision,
  local?: LocalDecisionSummary
): boolean {
  if (external.status === 'uncertain') return true
  if (!local) return false
  return (external.status === 'valid' && local.status === 'rejected')
    || (external.status === 'rejected' && local.status === 'valid')
}

async function attemptProvider(
  config: ProviderConfig,
  query: string,
  lens: SearchLens,
  intent: ExternalIntent,
  results: ScrapedResult[],
  candidateIds: number[],
  localDecisions: LocalDecisionSummary[],
  attempts: ExternalProviderAttempt[]
): Promise<ProviderResult | null> {
  const startedAt = Date.now()
  try {
    const result = await callProvider(config, query, lens, intent, results, candidateIds, localDecisions)
    attempts.push({
      provider: config.provider,
      model: config.model,
      status: 'success',
      runtimeMs: Date.now() - startedAt,
      candidateCount: candidateIds.length,
    })
    return result
  } catch (error) {
    attempts.push({
      provider: config.provider,
      model: config.model,
      status: 'failed',
      runtimeMs: Date.now() - startedAt,
      candidateCount: candidateIds.length,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    })
    return null
  }
}

export async function runExternalSmartFilterPool(
  query: string,
  lens: SearchLens,
  intent: ExternalIntent,
  results: ScrapedResult[],
  localDecisions: LocalDecisionSummary[]
): Promise<ExternalSmartFilterOutcome> {
  const configs = providerConfigs()
  const attempts: ExternalProviderAttempt[] = []
  if (!configs.length || !results.length) {
    return { configured: configs.length > 0, used: false, decisions: new Map(), attempts }
  }

  const candidateIds = results.slice(0, MAX_PRIMARY_CANDIDATES).map((_, index) => index)
  const cerebras = configs.find(config => config.provider === 'cerebras')
  const groq = configs.find(config => config.provider === 'groq')

  if (cerebras) {
    const primary = await attemptProvider(
      cerebras, query, lens, intent, results, candidateIds, localDecisions, attempts
    )
    if (primary) {
      const merged = new Map(primary.decisions)
      let mode: ExternalSmartFilterOutcome['mode'] = 'cerebras'

      if (groq) {
        const reviewIds = candidateIds
          .filter(id => {
            const decision = primary.decisions.get(id)
            return decision ? needsReview(decision, localDecisions[id]) : false
          })
          .slice(0, MAX_REVIEW_CANDIDATES)

        if (reviewIds.length) {
          const review = await attemptProvider(
            groq, query, lens, intent, results, reviewIds, localDecisions, attempts
          )
          if (review) {
            mode = 'cerebras+groq'
            for (const id of reviewIds) {
              const primaryDecision = merged.get(id)
              const reviewDecision = review.decisions.get(id)
              if (primaryDecision && reviewDecision) {
                merged.set(id, mergeProviderDecisions(primaryDecision, reviewDecision))
              }
            }
          }
        }
      }

      return {
        configured: true,
        used: true,
        mode,
        interpretation: primary.interpretation,
        decisions: merged,
        attempts,
      }
    }
  }

  if (groq) {
    const fallback = await attemptProvider(
      groq, query, lens, intent, results, candidateIds, localDecisions, attempts
    )
    if (fallback) {
      return {
        configured: true,
        used: true,
        mode: 'groq',
        interpretation: fallback.interpretation,
        decisions: fallback.decisions,
        attempts,
      }
    }
  }

  return {
    configured: true,
    used: false,
    decisions: new Map(),
    attempts,
  }
}
