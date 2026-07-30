import type { ScrapedResult } from '../types/search'

export type ManagedSearchProvider =
  | 'serper'
  | 'exa'
  | 'langsearch'
  | 'firecrawl'
  | 'olostep'

export type ManagedSearchAttemptStatus = 'success' | 'empty' | 'failed'

export interface ManagedSearchAttempt {
  provider: ManagedSearchProvider
  query: string
  status: ManagedSearchAttemptStatus
  resultCount: number
  runtimeMs: number
  keySlot: number
  error?: string
  failureKind?: 'authentication' | 'quota' | 'rate-limit' | 'timeout' | 'upstream' | 'malformed' | 'unknown'
}

export interface ManagedSearchProviderCapability {
  provider: ManagedSearchProvider
  configured: boolean
  keyCount: number
}

export interface ManagedSearchCapabilities {
  configured: boolean
  providers: ManagedSearchProviderCapability[]
  configuredProviders: ManagedSearchProvider[]
  configuredButUnwired: Array<{
    environmentVariable: string
    reason: string
  }>
}

export interface ManagedSearchDiagnostics {
  configuredProviders: ManagedSearchProvider[]
  selectedProviders: ManagedSearchProvider[]
  fallbackProviders: ManagedSearchProvider[]
  attemptedRequests: number
  successfulRequests: number
  emptyRequests: number
  failedRequests: number
  attempts: ManagedSearchAttempt[]
}

export interface ManagedSearchOptions {
  safeSearch: boolean
  preferredLanguage: string
  region: string
  limit?: number
  queryVariants?: string[]
}

export interface ManagedSearchEnvironment {
  [key: string]: string | undefined
}

type SearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface ProviderDefinition {
  provider: ManagedSearchProvider
  label: string
  environmentVariable: string
  endpoint: string
}

interface ProviderRun {
  provider: ManagedSearchProvider
  query: string
  results: ScrapedResult[]
  attempts: ManagedSearchAttempt[]
}

const PROVIDERS: ProviderDefinition[] = [
  {
    provider: 'serper',
    label: 'Serper',
    environmentVariable: 'SERPER_API_KEY',
    endpoint: 'https://google.serper.dev/search',
  },
  {
    provider: 'exa',
    label: 'Exa',
    environmentVariable: 'EXA_API_KEY',
    endpoint: 'https://api.exa.ai/search',
  },
  {
    provider: 'langsearch',
    label: 'LangSearch',
    environmentVariable: 'LANGSEARCH_API_KEY',
    endpoint: 'https://api.langsearch.com/v1/web-search',
  },
  {
    provider: 'firecrawl',
    label: 'Firecrawl Search',
    environmentVariable: 'FIRECRAWL_API_KEY',
    endpoint: 'https://api.firecrawl.dev/v2/search',
  },
  {
    provider: 'olostep',
    label: 'Olostep Search',
    environmentVariable: 'OLOSTEP_API_KEY',
    endpoint: 'https://api.olostep.com/v1/searches',
  },
]

const PROVIDER_TIMEOUT_MS = 7_000
const PRIMARY_PROVIDER_COUNT = 3
const MINIMUM_RESULT_POOL = 8

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function configuredKeys(
  environmentVariable: string,
  environment: ManagedSearchEnvironment
): string[] {
  const pluralVariable = environmentVariable.replace(/_KEY$/, '_KEYS')
  const names = [
    environmentVariable,
    `${environmentVariable}_SECONDARY`,
    `${environmentVariable}_TERTIARY`,
    `${environmentVariable}_QUATERNARY`,
    ...Array.from({ length: 10 }, (_, index) => `${environmentVariable}_${index + 2}`),
  ]
  const values = [
    ...names.map(name => environment[name] || ''),
    ...(environment[pluralVariable] || '').split(/[\n,;]/),
  ]
  return unique(values.map(value => value.trim()))
}

export function managedSearchCapabilities(
  environment: ManagedSearchEnvironment = process.env
): ManagedSearchCapabilities {
  const providers = PROVIDERS.map(definition => {
    const keys = configuredKeys(definition.environmentVariable, environment)
    return {
      provider: definition.provider,
      configured: keys.length > 0,
      keyCount: keys.length,
    }
  })
  const configuredButUnwired: ManagedSearchCapabilities['configuredButUnwired'] = []
  if (environment.WEBSEARCH_API_KEY?.trim()) {
    configuredButUnwired.push({
      environmentVariable: 'WEBSEARCH_API_KEY',
      reason: 'The provider endpoint cannot be inferred safely from the key alone.',
    })
  }
  return {
    configured: providers.some(provider => provider.configured),
    providers,
    configuredProviders: providers
      .filter(provider => provider.configured)
      .map(provider => provider.provider),
    configuredButUnwired,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim()
    if (Array.isArray(value)) {
      const combined = value
        .filter(item => typeof item === 'string')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (combined) return combined
    }
  }
  return ''
}

function providerItems(provider: ManagedSearchProvider, payload: unknown): unknown[] {
  const root = asRecord(payload)
  const data = asRecord(root.data)
  const webPages = asRecord(data.webPages || root.webPages)
  const result = asRecord(root.result)

  if (provider === 'serper') return asArray(root.organic)
  if (provider === 'exa') return asArray(root.results)
  if (provider === 'langsearch') {
    return asArray(webPages.value).length
      ? asArray(webPages.value)
      : asArray(data.results).length
        ? asArray(data.results)
        : asArray(root.results).length
          ? asArray(root.results)
          : asArray(root.data)
  }
  if (provider === 'firecrawl') {
    return asArray(data.web).length
      ? asArray(data.web)
      : asArray(root.web).length
        ? asArray(root.web)
        : asArray(root.data)
  }
  return asArray(result.links).length
    ? asArray(result.links)
    : asArray(root.links)
}

function normalizeProviderResults(
  definition: ProviderDefinition,
  payload: unknown,
  query: string
): ScrapedResult[] {
  const results: ScrapedResult[] = []
  const seen = new Set<string>()
  for (const item of providerItems(definition.provider, payload)) {
    const record = asRecord(item)
    const url = stringValue(record.url, record.link, record.id)
    const title = stringValue(record.title, record.name)
    if (!url || !title) continue
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue
      parsed.hash = ''
      const normalizedUrl = parsed.toString().replace(/\/$/, '')
      const key = normalizedUrl.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        title,
        url: normalizedUrl,
        description: stringValue(
          record.description,
          record.snippet,
          record.summary,
          record.content,
          record.highlights,
          record.text
        ).slice(0, 1_200),
        domain: parsed.hostname.replace(/^www\./, ''),
        source: definition.label,
        rank: results.length + 1,
        score: 0,
        retrieval: {
          sources: [definition.label],
          queries: [query],
          purposes: ['managed-api-discovery'],
          overlap: 1,
        },
      })
    } catch {
      // Ignore malformed provider URLs while preserving other results.
    }
  }
  return results
}

function requestForProvider(
  definition: ProviderDefinition,
  key: string,
  query: string,
  options: ManagedSearchOptions
): { headers: HeadersInit; body: Record<string, unknown> } {
  const limit = Math.max(5, Math.min(20, options.limit || 12))
  const language = options.preferredLanguage || 'en'
  const region = (options.region || 'us').slice(0, 2).toLowerCase()

  if (definition.provider === 'serper') {
    return {
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: {
        q: query,
        num: limit,
        gl: region,
        hl: language,
        autocorrect: true,
        ...(options.safeSearch ? { safe: 'active' } : {}),
      },
    }
  }
  if (definition.provider === 'exa') {
    return {
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: {
        query,
        type: 'auto',
        numResults: limit,
        contents: {
          highlights: {
            maxCharacters: 1_000,
          },
        },
      },
    }
  }
  if (definition.provider === 'langsearch') {
    return {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: {
        query,
        freshness: 'noLimit',
        summary: true,
        count: limit,
      },
    }
  }
  if (definition.provider === 'firecrawl') {
    return {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: {
        query,
        limit,
        sources: ['web'],
        country: region.toUpperCase(),
        timeout: PROVIDER_TIMEOUT_MS - 500,
        ignoreInvalidURLs: true,
      },
    }
  }
  return {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: {
      query,
      limit,
      fast_mode: true,
    },
  }
}

function failureKind(
  status: number | undefined,
  message: string
): ManagedSearchAttempt['failureKind'] {
  if (status === 401 || status === 403) return 'authentication'
  if (status === 402 || /\b(?:credit|quota|balance|exhausted)\b/i.test(message)) return 'quota'
  if (status === 429) return 'rate-limit'
  if (status && status >= 500) return 'upstream'
  if (/timed?\s*out|abort/i.test(message)) return 'timeout'
  if (/json|malformed|parse/i.test(message)) return 'malformed'
  return 'unknown'
}

function shouldRotateKey(kind: ManagedSearchAttempt['failureKind']): boolean {
  return kind === 'authentication' || kind === 'quota' || kind === 'rate-limit'
}

function sanitizedProviderError(message: string, keys: string[]): string {
  let sanitized = message
  for (const key of keys) {
    if (key.length >= 6) sanitized = sanitized.split(key).join('[redacted]')
  }
  return sanitized
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{6,}/gi, 'Bearer [redacted]')
    .replace(
      /\b(api[-_ ]?key|authorization|token)\b(\s*[:=]\s*)[A-Za-z0-9._~+/-]{6,}/gi,
      '$1$2[redacted]'
    )
    .slice(0, 300)
}

async function fetchProvider(
  definition: ProviderDefinition,
  key: string,
  query: string,
  options: ManagedSearchOptions,
  fetchFn: SearchFetch
): Promise<{ payload: unknown; status: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const request = requestForProvider(definition, key, query, options)
    const response = await fetchFn(definition.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await response.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`${definition.label} returned malformed JSON`)
    }
    if (!response.ok) {
      const record = asRecord(payload)
      const message = stringValue(record.error, record.message, record.detail)
      throw Object.assign(
        new Error(`${definition.label} returned HTTP ${response.status}${message ? `: ${message.slice(0, 180)}` : ''}`),
        { status: response.status }
      )
    }
    return { payload, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}

async function runProvider(
  definition: ProviderDefinition,
  query: string,
  options: ManagedSearchOptions,
  environment: ManagedSearchEnvironment,
  fetchFn: SearchFetch
): Promise<ProviderRun> {
  const keys = configuredKeys(definition.environmentVariable, environment)
  const offset = keys.length ? stableHash(`${definition.provider}:${query}`) % keys.length : 0
  const rotatedKeys = [...keys.slice(offset), ...keys.slice(0, offset)]
  const attempts: ManagedSearchAttempt[] = []

  for (const [index, key] of rotatedKeys.entries()) {
    const startedAt = Date.now()
    try {
      const response = await fetchProvider(definition, key, query, options, fetchFn)
      const results = normalizeProviderResults(definition, response.payload, query)
      attempts.push({
        provider: definition.provider,
        query,
        status: results.length ? 'success' : 'empty',
        resultCount: results.length,
        runtimeMs: Date.now() - startedAt,
        keySlot: ((offset + index) % keys.length) + 1,
        ...(results.length ? {} : { error: `${definition.label} returned no usable links` }),
      })
      return { provider: definition.provider, query, results, attempts }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = sanitizedProviderError(rawMessage, keys)
      const status = typeof error === 'object' && error && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : undefined
      const kind = failureKind(status, message)
      attempts.push({
        provider: definition.provider,
        query,
        status: 'failed',
        resultCount: 0,
        runtimeMs: Date.now() - startedAt,
        keySlot: ((offset + index) % keys.length) + 1,
        error: message,
        failureKind: kind,
      })
      if (!shouldRotateKey(kind)) break
    }
  }

  return { provider: definition.provider, query, results: [], attempts }
}

function dedupe(results: ScrapedResult[]): ScrapedResult[] {
  const merged = new Map<string, ScrapedResult>()
  for (const result of results) {
    const key = result.url.toLowerCase()
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, result)
      continue
    }
    merged.set(key, {
      ...existing,
      description: existing.description.length >= result.description.length
        ? existing.description
        : result.description,
      retrieval: {
        sources: unique([
          ...(existing.retrieval?.sources || [existing.source]),
          ...(result.retrieval?.sources || [result.source]),
        ]),
        queries: unique([
          ...(existing.retrieval?.queries || []),
          ...(result.retrieval?.queries || []),
        ]),
        purposes: unique([
          ...(existing.retrieval?.purposes || []),
          ...(result.retrieval?.purposes || []),
        ]),
        overlap: new Set([
          ...(existing.retrieval?.sources || [existing.source]),
          ...(result.retrieval?.sources || [result.source]),
        ]).size,
      },
    })
  }
  return Array.from(merged.values()).map((result, index) => ({
    ...result,
    rank: index + 1,
  }))
}

export async function searchManagedWeb(
  query: string,
  options: ManagedSearchOptions,
  environment: ManagedSearchEnvironment = process.env,
  fetchFn: SearchFetch = fetch
): Promise<{
  text: string
  results: ScrapedResult[]
  diagnostics: ManagedSearchDiagnostics
}> {
  const capabilities = managedSearchCapabilities(environment)
  const definitions = PROVIDERS.filter(definition =>
    capabilities.configuredProviders.includes(definition.provider)
  )
  if (!definitions.length) {
    return {
      text: '',
      results: [],
      diagnostics: {
        configuredProviders: [],
        selectedProviders: [],
        fallbackProviders: [],
        attemptedRequests: 0,
        successfulRequests: 0,
        emptyRequests: 0,
        failedRequests: 0,
        attempts: [],
      },
    }
  }

  const providerOffset = stableHash(query) % definitions.length
  const ordered = [...definitions.slice(providerOffset), ...definitions.slice(0, providerOffset)]
  const primary = ordered.slice(0, Math.min(PRIMARY_PROVIDER_COUNT, ordered.length))
  const fallbacks = ordered.slice(primary.length)
  const queries = unique([query, ...(options.queryVariants || [])]).slice(0, 4)
  const queryFor = (provider: ProviderDefinition, index: number) =>
    queries[(stableHash(provider.provider) + index) % queries.length] || query

  const primaryRuns = await Promise.all(primary.map((provider, index) =>
    runProvider(provider, queryFor(provider, index), options, environment, fetchFn)
  ))
  let runs = [...primaryRuns]
  let combined = dedupe(runs.flatMap(run => run.results))
  const usedFallbacks: ProviderDefinition[] = []

  if (combined.length < MINIMUM_RESULT_POOL && fallbacks.length > 0) {
    usedFallbacks.push(...fallbacks)
    const fallbackRuns = await Promise.all(fallbacks.map((provider, index) =>
      runProvider(provider, queryFor(provider, primary.length + index), options, environment, fetchFn)
    ))
    runs = [...runs, ...fallbackRuns]
    combined = dedupe(runs.flatMap(run => run.results))
  }

  const attempts = runs.flatMap(run => run.attempts)
  return {
    text: combined.flatMap(result => [result.title, result.description, result.url]).join(' '),
    results: combined,
    diagnostics: {
      configuredProviders: capabilities.configuredProviders,
      selectedProviders: primary.map(provider => provider.provider),
      fallbackProviders: usedFallbacks.map(provider => provider.provider),
      attemptedRequests: attempts.length,
      successfulRequests: attempts.filter(attempt => attempt.status === 'success').length,
      emptyRequests: attempts.filter(attempt => attempt.status === 'empty').length,
      failedRequests: attempts.filter(attempt => attempt.status === 'failed').length,
      attempts,
    },
  }
}
