import type { SearchLens } from '../types/search'

export type SemanticIntentComplexity = 'simple' | 'moderate' | 'complex'

export interface SemanticIntentPlan {
  interpretation: string
  requiredConcepts: string[]
  optionalConcepts: string[]
  exclusions: string[]
  geography: string[]
  timeConstraints: string[]
  sourcePreferences: string[]
  searchVariants: string[]
  suggestedLens: SearchLens
  complexity: SemanticIntentComplexity
  usedExternal: boolean
  provider: 'gemini' | 'deterministic'
  model?: string
  runtimeMs: number
  error?: string
}

export interface SemanticIntentCapabilities {
  configured: boolean
  model: string
}

export interface SemanticIntentEnvironment {
  [key: string]: string | undefined
  GEMINI_API_KEY?: string
  GEMINI_INTENT_MODEL?: string
  GEMINI_MODEL?: string
}

interface GeminiIntentPayload {
  interpretation?: unknown
  requiredConcepts?: unknown
  optionalConcepts?: unknown
  exclusions?: unknown
  geography?: unknown
  timeConstraints?: unknown
  sourcePreferences?: unknown
  searchVariants?: unknown
  suggestedLens?: unknown
  complexity?: unknown
}

const GEMINI_TIMEOUT_MS = 7_000
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite'
const VALID_LENSES = new Set<SearchLens>([
  'web', 'pdf', 'government', 'procurement', 'pricing', 'provider',
  'technical', 'news', 'legal', 'medical', 'academic', 'financial',
])
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'what', 'when', 'where', 'which', 'who', 'with', 'you',
])

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeArray(value: unknown, limit: number, maxLength = 180): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = normalizeSpace(item).slice(0, maxLength)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
    if (output.length >= limit) break
  }
  return output
}

function configuredModel(env: SemanticIntentEnvironment): string {
  return env.GEMINI_INTENT_MODEL?.trim()
    || env.GEMINI_MODEL?.trim()
    || DEFAULT_GEMINI_MODEL
}

function deterministicConcepts(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = normalized
    .split(' ')
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token))
  return Array.from(new Set(tokens)).slice(0, 12)
}

function deterministicComplexity(query: string): SemanticIntentComplexity {
  const words = normalizeSpace(query).split(' ').filter(Boolean).length
  const constraints = (query.match(/[",:()\-]|\b(?:before|after|within|near|excluding|without|open|current|latest|price|cost|rfp|provider)\b/gi) || []).length
  if (words >= 10 || constraints >= 3) return 'complex'
  if (words >= 5 || constraints >= 1) return 'moderate'
  return 'simple'
}

function fallbackPlan(query: string, lens: SearchLens, startedAt: number, error?: string): SemanticIntentPlan {
  return {
    interpretation: normalizeSpace(query),
    requiredConcepts: deterministicConcepts(query),
    optionalConcepts: [],
    exclusions: [],
    geography: [],
    timeConstraints: [],
    sourcePreferences: [],
    searchVariants: [],
    suggestedLens: lens,
    complexity: deterministicComplexity(query),
    usedExternal: false,
    provider: 'deterministic',
    runtimeMs: Date.now() - startedAt,
    error,
  }
}

export function semanticIntentCapabilities(
  env: SemanticIntentEnvironment = process.env
): SemanticIntentCapabilities {
  return {
    configured: Boolean(env.GEMINI_API_KEY?.trim()),
    model: configuredModel(env),
  }
}

export function parseGeminiIntentPayload(
  value: string,
  query: string,
  requestedLens: SearchLens,
  model: string,
  runtimeMs: number
): SemanticIntentPlan {
  const payload = JSON.parse(value) as GeminiIntentPayload
  const suggestedLens = typeof payload.suggestedLens === 'string'
    && VALID_LENSES.has(payload.suggestedLens as SearchLens)
    ? payload.suggestedLens as SearchLens
    : requestedLens
  const complexity: SemanticIntentComplexity = payload.complexity === 'simple'
    || payload.complexity === 'moderate'
    || payload.complexity === 'complex'
    ? payload.complexity
    : deterministicComplexity(query)
  const requiredConcepts = normalizeArray(payload.requiredConcepts, 12)
  const searchVariants = normalizeArray(payload.searchVariants, 8, 260)
    .filter(variant => variant.toLowerCase() !== normalizeSpace(query).toLowerCase())

  return {
    interpretation: typeof payload.interpretation === 'string' && payload.interpretation.trim()
      ? normalizeSpace(payload.interpretation).slice(0, 500)
      : normalizeSpace(query),
    requiredConcepts: requiredConcepts.length ? requiredConcepts : deterministicConcepts(query),
    optionalConcepts: normalizeArray(payload.optionalConcepts, 10),
    exclusions: normalizeArray(payload.exclusions, 10),
    geography: normalizeArray(payload.geography, 8),
    timeConstraints: normalizeArray(payload.timeConstraints, 8),
    sourcePreferences: normalizeArray(payload.sourcePreferences, 8),
    searchVariants,
    suggestedLens,
    complexity,
    usedExternal: true,
    provider: 'gemini',
    model,
    runtimeMs,
  }
}

export function geminiResponseSchema() {
  return {
    type: 'object',
    properties: {
      interpretation: { type: 'string' },
      requiredConcepts: { type: 'array', items: { type: 'string' } },
      optionalConcepts: { type: 'array', items: { type: 'string' } },
      exclusions: { type: 'array', items: { type: 'string' } },
      geography: { type: 'array', items: { type: 'string' } },
      timeConstraints: { type: 'array', items: { type: 'string' } },
      sourcePreferences: { type: 'array', items: { type: 'string' } },
      searchVariants: { type: 'array', items: { type: 'string' } },
      suggestedLens: {
        type: 'string',
        enum: Array.from(VALID_LENSES),
      },
      complexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex'],
      },
    },
    required: [
      'interpretation', 'requiredConcepts', 'optionalConcepts', 'exclusions',
      'geography', 'timeConstraints', 'sourcePreferences', 'searchVariants',
      'suggestedLens', 'complexity',
    ],
  }
}

function plannerPrompt(query: string, lens: SearchLens): string {
  return [
    'You are the semantic intent planner for a public-web metasearch engine.',
    'Understand the complete request without reducing it to one broad keyword.',
    'Separate required concepts from optional context, exclusions, geography, time constraints, and preferred source types.',
    'Generate up to eight concise search variants. Every variant must preserve the complete required intent, except that exact synonyms or a locally appropriate translation may replace a concept.',
    'Include useful local-language variants when the location strongly implies another language.',
    'Do not add facts, organizations, dates, or locations that the user did not request.',
    'Do not answer the query. Return only the structured plan.',
    `Requested lens: ${lens}`,
    `User query: ${query}`,
  ].join('\n')
}

export async function planSemanticIntent(
  query: string,
  lens: SearchLens,
  env: SemanticIntentEnvironment = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<SemanticIntentPlan> {
  const startedAt = Date.now()
  const apiKey = env.GEMINI_API_KEY?.trim()
  const model = configuredModel(env)
  if (!apiKey) return fallbackPlan(query, lens, startedAt)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: plannerPrompt(query, lens) }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1_600,
            responseMimeType: 'application/json',
            responseSchema: geminiResponseSchema(),
          },
        }),
        signal: controller.signal,
        cache: 'no-store',
      }
    )
    const responseText = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`)

    const envelope = JSON.parse(responseText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = envelope.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim() || ''
    if (!text) throw new Error('Gemini returned no semantic plan')

    return parseGeminiIntentPayload(text, query, lens, model, Date.now() - startedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Gemini semantic intent planning failed; using deterministic planning:', message)
    return fallbackPlan(query, lens, startedAt, message.slice(0, 500))
  } finally {
    clearTimeout(timer)
  }
}
