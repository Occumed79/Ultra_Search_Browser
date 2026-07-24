import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cloudflareRerankCapabilities,
  parseCloudflareRerankScores,
} from '../src/lib/cloudflare-reranker'
import {
  geminiResponseSchema,
  normalizeGeminiModel,
  parseGeminiIntentPayload,
  planSemanticIntent,
  semanticIntentCapabilities,
  type SemanticIntentPlan,
} from '../src/lib/semantic-intent'
import {
  buildQueryVariants,
  buildRetrievalTasks,
  semanticBudgets,
} from '../src/lib/search-planner'
import type { ExpandedQuery } from '../src/lib/intelligence'
import type { OperatorsResult } from '../src/lib/search-operators'
import type { SearchPlan } from '../src/lib/search-settings'

test('Gemini semantic payload preserves complete multi-concept intent', () => {
  const plan = parseGeminiIntentPayload(JSON.stringify({
    interpretation: 'Find occupational-health clinics in Stuttgart that provide pure-tone audiograms.',
    requiredConcepts: ['occupational health clinic', 'pure-tone audiogram', 'Stuttgart'],
    optionalConcepts: ['employer referrals'],
    exclusions: ['hearing aid retailers', 'jobs'],
    geography: ['Stuttgart, Germany'],
    timeConstraints: [],
    sourcePreferences: ['official clinic pages'],
    searchVariants: [
      'Arbeitsmedizin Audiometrie Stuttgart',
      'occupational health pure tone audiogram Stuttgart',
    ],
    suggestedLens: 'provider',
    complexity: 'complex',
  }), 'occupational health clinics in Stuttgart offering pure-tone audiograms', 'provider', 'gemini-3.5-flash-lite', 121)

  assert.equal(plan.usedExternal, true)
  assert.equal(plan.provider, 'gemini')
  assert.equal(plan.suggestedLens, 'provider')
  assert.equal(plan.requiredConcepts.length, 3)
  assert.ok(plan.searchVariants.some(variant => /Arbeitsmedizin/i.test(variant)))
  assert.deepEqual(semanticBudgets(plan), { variants: 12, tasks: 28 })
})

test('retired Gemini model variables migrate to the current stable Flash-Lite model', () => {
  assert.equal(normalizeGeminiModel('gemini-2.5-flash-lite'), 'gemini-3.5-flash-lite')
  assert.equal(normalizeGeminiModel('gemini-3.1-flash-lite-preview'), 'gemini-3.5-flash-lite')
  assert.equal(normalizeGeminiModel('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite')
  assert.equal(
    semanticIntentCapabilities({
      GEMINI_API_KEY: 'key',
      GEMINI_INTENT_MODEL: 'gemini-2.5-flash-lite',
    }).model,
    'gemini-3.5-flash-lite'
  )
})

test('Gemini response schema excludes unsupported additionalProperties keyword', () => {
  const schema = geminiResponseSchema() as Record<string, unknown>
  assert.equal('additionalProperties' in schema, false)
  assert.equal(schema.type, 'object')
  assert.ok(Array.isArray(schema.required))
})

test('Gemini planner sends the current model with a supported request shape', async () => {
  let requestedUrl = ''
  let requestBody: Record<string, unknown> | undefined
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url)
    requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              interpretation: 'Find occupational health services.',
              requiredConcepts: ['occupational health services'],
              optionalConcepts: [],
              exclusions: [],
              geography: [],
              timeConstraints: [],
              sourcePreferences: ['official provider pages'],
              searchVariants: ['occupational medicine services'],
              suggestedLens: 'web',
              complexity: 'simple',
            }),
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const plan = await planSemanticIntent(
    'occupational health services',
    'web',
    {
      GEMINI_API_KEY: 'test-key',
      GEMINI_INTENT_MODEL: 'gemini-2.5-flash-lite',
    },
    fetchImpl
  )

  const generationConfig = requestBody?.generationConfig as Record<string, unknown>
  const schema = generationConfig.responseSchema as Record<string, unknown>
  assert.match(requestedUrl, /gemini-3\.5-flash-lite/)
  assert.equal('additionalProperties' in schema, false)
  assert.equal('temperature' in generationConfig, false)
  assert.equal(plan.usedExternal, true)
  assert.equal(plan.model, 'gemini-3.5-flash-lite')
  assert.deepEqual(plan.searchVariants, ['occupational medicine services'])
})

test('semantic provider capabilities require complete credentials', () => {
  assert.equal(semanticIntentCapabilities({ GEMINI_API_KEY: 'key' }).configured, true)
  assert.equal(cloudflareRerankCapabilities({
    CLOUDFLARE_ACCOUNT_ID: 'account',
    CLOUDFLARE_API_TOKEN: 'token',
  }).configured, true)
  assert.equal(cloudflareRerankCapabilities({ CLOUDFLARE_API_TOKEN: 'token' }).configured, false)
})

test('Cloudflare reranker scores are parsed and normalized', () => {
  const scores = parseCloudflareRerankScores({
    success: true,
    result: {
      response: [
        { id: 1, score: 0.91 },
        { id: 0, score: -2 },
        { id: 99, score: 1 },
      ],
    },
  }, 2)

  assert.equal(scores.size, 2)
  assert.equal(scores.get(1), 0.91)
  assert.ok((scores.get(0) || 0) > 0 && (scores.get(0) || 0) < 0.5)
})

test('complex Gemini intent expands the adaptive fan-out without losing original queries', () => {
  const operators: OperatorsResult = {
    cleanQuery: 'occupational health clinics in Stuttgart offering pure-tone audiograms',
    includedSites: [],
    excludedSites: [],
    fileTypes: [],
    inUrlTerms: [],
    inTitleTerms: [],
    exactPhrases: [],
    requiredTerms: ['occupational', 'health', 'clinics', 'Stuttgart', 'pure-tone', 'audiograms'],
    excludedTerms: [],
    booleanMode: null,
  }
  const expanded: ExpandedQuery = {
    original: operators.cleanQuery,
    lens: 'provider',
    expansions: ['occupational medicine audiometry Stuttgart official clinic'],
    withOperators: [],
    synonyms: {},
  }
  const plan: SearchPlan = {
    liveSources: ['google', 'bing', 'duckduckgo'],
    useMemory: true,
    resultsPerPage: 20,
    autoSummarize: true,
    safeSearch: true,
    preferredLanguage: 'en',
    region: 'de',
  }
  const semanticIntent: SemanticIntentPlan = {
    interpretation: operators.cleanQuery,
    requiredConcepts: ['occupational health', 'pure-tone audiogram', 'Stuttgart'],
    optionalConcepts: [],
    exclusions: ['jobs'],
    geography: ['Stuttgart, Germany'],
    timeConstraints: [],
    sourcePreferences: ['official clinic pages'],
    searchVariants: [
      'Arbeitsmedizin Audiometrie Stuttgart',
      'occupational medicine pure tone hearing test Stuttgart',
      'Betriebsarzt Hörtest Stuttgart',
    ],
    suggestedLens: 'provider',
    complexity: 'complex',
    usedExternal: true,
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    runtimeMs: 100,
  }

  const variants = buildQueryVariants(
    operators.cleanQuery,
    'provider',
    expanded,
    operators,
    2026,
    semanticIntent
  )
  const tasks = buildRetrievalTasks(variants, plan, semanticBudgets(semanticIntent).tasks)

  assert.ok(variants.some(variant => variant.purpose === 'ai-intent'))
  assert.deepEqual(
    tasks.filter(task => task.query === operators.cleanQuery).map(task => task.source),
    ['google', 'bing', 'duckduckgo']
  )
  assert.deepEqual(
    tasks.filter(task => task.query === `"${operators.cleanQuery}"`).map(task => task.source),
    ['google', 'bing', 'duckduckgo']
  )
  assert.ok(tasks.length > 14)
  assert.ok(tasks.length <= 28)
})
