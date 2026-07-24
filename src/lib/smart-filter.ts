import { lensCompatibilityAdjustment } from './ranking-signals'
import { scoreLexicalRelevance } from './semantic-search'
import type { ScrapedResult, SearchLens } from '../types/search'

export type SmartFilterStatus = 'valid' | 'uncertain' | 'rejected'
export type SmartFilterMode = 'ai' | 'local'

export interface SearchIntent {
  originalQuery: string
  interpretation: string
  requiredConcepts: string[]
  exactPhrases: string[]
  minimumRequiredMatches: number
}

export interface SmartFilterDiagnostics {
  mode: SmartFilterMode
  aiConfigured: boolean
  aiSucceeded: boolean
  candidateCount: number
  validCount: number
  uncertainCount: number
  rejectedCount: number
  displayedCount: number
  interpretation: string
  requiredConcepts: string[]
  failure?: string
}

interface LocalDecision {
  status: SmartFilterStatus
  relevance: number
  matchedConcepts: string[]
  reason: string
}

interface AiDecision {
  id: number
  status: 'valid' | 'uncertain' | 'reject'
  relevance: number
  reason: string
}

interface AiResponse {
  interpretation: string
  decisions: AiDecision[]
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

function exactPhrases(query: string): string[] {
  const quoted = Array.from(query.matchAll(/["“”]([^"“”]{2,})["“”]/g))
    .map(match => normalize(match[1]))
    .filter(Boolean)

  const tokens = meaningfulTokens(query)
  const protectedPairs: string[] = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index]
    const right = tokens[index + 1]
    if (left.length >= 4 && right.length >= 4) protectedPairs.push(`${left} ${right}`)
  }

  return unique([...quoted, ...protectedPairs]).slice(0, 4)
}

export function analyzeSearchIntent(query: string): SearchIntent {
  const requiredConcepts = meaningfulTokens(query)
  return {
    originalQuery: query.trim(),
    interpretation: query.trim(),
    requiredConcepts,
    exactPhrases: exactPhrases(query),
    minimumRequiredMatches: Math.max(1, Math.ceil(requiredConcepts.length * 0.6)),
  }
}

function candidateText(result: ScrapedResult): string {
  return normalize(`${result.title} ${result.description} ${result.url} ${result.domain}`)
}

function matchedConcepts(intent: SearchIntent, result: ScrapedResult): string[] {
  const text = candidateText(result)
  const tokens = new Set(text.split(' '))
  return intent.requiredConcepts.filter(concept =>
    tokens.has(concept) || (concept.length >= 5 && text.includes(concept))
  )
}

function localDecision(query: string, lens: SearchLens, intent: SearchIntent, result: ScrapedResult): LocalDecision {
  const matches = matchedConcepts(intent, result)
  const relevance = scoreLexicalRelevance(query, {
    title: result.title,
    text: `${result.title} ${result.description}`,
    url: result.url,
  })
  const lensAdjustment = lensCompatibilityAdjustment(lens, result)
  const phraseHit = intent.exactPhrases.some(phrase => candidateText(result).includes(phrase))
  const enoughConcepts = matches.length >= intent.minimumRequiredMatches

  if (enoughConcepts && (relevance >= 0.22 || phraseHit) && lensAdjustment > -24) {
    return {
      status: 'valid',
      relevance,
      matchedConcepts: matches,
      reason: `Matches ${matches.length}/${intent.requiredConcepts.length || 1} required concepts${phraseHit ? ' and a protected phrase' : ''}.`,
    }
  }

  if (
    matches.length >= Math.max(1, intent.minimumRequiredMatches - 1)
    && relevance >= 0.12
    && lensAdjustment > -28
  ) {
    return {
      status: 'uncertain',
      relevance,
      matchedConcepts: matches,
      reason: `Partial match: ${matches.length}/${intent.requiredConcepts.length || 1} required concepts.`,
    }
  }

  return {
    status: 'rejected',
    relevance,
    matchedConcepts: matches,
    reason: matches.length
      ? `Only ${matches.length}/${intent.requiredConcepts.length || 1} required concepts matched.`
      : 'The result does not match the meaningful concepts in the full query.',
  }
}

function readOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  if (!Array.isArray(record.output)) return ''

  for (const item of record.output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === 'string') return text
    }
  }
  return ''
}

async function callAiFilter(
  query: string,
  lens: SearchLens,
  intent: SearchIntent,
  results: ScrapedResult[]
): Promise<AiResponse> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  const candidates = results.slice(0, 50).map((result, id) => ({
    id,
    title: result.title.slice(0, 240),
    url: result.url.slice(0, 500),
    snippet: result.description.slice(0, 700),
    source: result.source,
  }))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_SMART_MODEL || 'gpt-5-mini',
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'You are the relevance gate inside a metasearch super-filter.',
                  'Judge whether each candidate answers the user’s complete query, not whether it matches one isolated word.',
                  'Mark valid only when the title, URL, and snippet jointly support the whole intent.',
                  'Mark reject for generic homepages, wrong meanings, weak one-word matches, unrelated jobs/products, or lens-incompatible pages.',
                  'Use uncertain when the snippet is insufficient but the result could plausibly answer the query.',
                  'Do not claim that a page is live, current, or unexpired unless the supplied metadata proves it.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  query,
                  lens,
                  requiredConcepts: intent.requiredConcepts,
                  exactPhrases: intent.exactPhrases,
                  candidates,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'search_candidate_filter',
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
                      status: { type: 'string', enum: ['valid', 'uncertain', 'reject'] },
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
        },
      }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message = payload && typeof payload === 'object'
        ? JSON.stringify(payload).slice(0, 500)
        : `HTTP ${response.status}`
      throw new Error(`OpenAI smart filter failed: ${message}`)
    }

    const outputText = readOutputText(payload)
    if (!outputText) throw new Error('OpenAI smart filter returned no structured output')
    return JSON.parse(outputText) as AiResponse
  } finally {
    clearTimeout(timeout)
  }
}

function mergeDecision(local: LocalDecision, ai?: AiDecision): LocalDecision {
  if (!ai) return local
  const aiRelevance = Math.max(0, Math.min(1, Number(ai.relevance) || 0))

  if (ai.status === 'valid') {
    return {
      ...local,
      status: 'valid',
      relevance: Math.max(local.relevance, aiRelevance),
      reason: ai.reason,
    }
  }

  if (ai.status === 'reject') {
    // A very strong local whole-query match is not removed solely by one model judgment.
    if (local.status === 'valid' && local.relevance >= 0.72) {
      return { ...local, status: 'uncertain', reason: ai.reason }
    }
    return { ...local, status: 'rejected', relevance: Math.min(local.relevance, aiRelevance), reason: ai.reason }
  }

  return {
    ...local,
    status: local.status === 'rejected' ? 'uncertain' : local.status,
    relevance: Math.max(local.relevance, aiRelevance),
    reason: ai.reason,
  }
}

export async function applySmartFilter(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[],
  displayLimit: number
): Promise<{ results: ScrapedResult[]; diagnostics: SmartFilterDiagnostics }> {
  const intent = analyzeSearchIntent(query)
  const localDecisions = results.map(result => localDecision(query, lens, intent, result))
  const aiConfigured = Boolean(process.env.OPENAI_API_KEY)
  let aiSucceeded = false
  let aiFailure: string | undefined
  let interpretation = intent.interpretation
  let aiDecisions = new Map<number, AiDecision>()

  if (aiConfigured && results.length > 0) {
    try {
      const ai = await callAiFilter(query, lens, intent, results)
      interpretation = ai.interpretation?.trim() || interpretation
      aiDecisions = new Map(
        ai.decisions
          .filter(decision => Number.isInteger(decision.id) && decision.id >= 0 && decision.id < results.length)
          .map(decision => [decision.id, decision])
      )
      aiSucceeded = true
    } catch (error) {
      aiFailure = error instanceof Error ? error.message : String(error)
      console.warn('AI smart filter failed; using local full-query filter:', aiFailure)
    }
  }

  const classified = results.map((result, index) => {
    const decision = mergeDecision(localDecisions[index], aiDecisions.get(index))
    const statusAdjustment = decision.status === 'valid'
      ? Math.round(decision.relevance * 22)
      : decision.status === 'uncertain'
        ? -6
        : -40

    return {
      ...result,
      score: result.score + statusAdjustment,
      validation: {
        status: decision.status,
        relevance: Number(decision.relevance.toFixed(3)),
        reason: decision.reason,
        matchedConcepts: decision.matchedConcepts,
        mode: aiSucceeded ? 'ai' as const : 'local' as const,
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

  // Fail open with clearly labeled uncertainty rather than producing a false zero-result page.
  if (displayed.length === 0 && classified.length > 0) {
    displayed = classified
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(5, displayLimit))
      .map(result => ({
        ...result,
        validation: {
          ...result.validation,
          status: 'uncertain' as const,
          reason: `No candidate passed the strict filter. ${result.validation.reason}`,
        },
      }))
  }

  displayed = displayed.slice(0, displayLimit).map((result, index) => ({ ...result, rank: index + 1 }))

  return {
    results: displayed,
    diagnostics: {
      mode: aiSucceeded ? 'ai' : 'local',
      aiConfigured,
      aiSucceeded,
      candidateCount: results.length,
      validCount: valid.length,
      uncertainCount: uncertain.length,
      rejectedCount: rejected.length,
      displayedCount: displayed.length,
      interpretation,
      requiredConcepts: intent.requiredConcepts,
      failure: aiFailure,
    },
  }
}
