import type { ScrapedResult } from '../types/search'

export interface CloudflareRerankDiagnostics {
  configured: boolean
  used: boolean
  model: string
  runtimeMs: number
  candidateCount: number
  scoredCount: number
  error?: string
}

export interface CloudflareRerankOutcome {
  results: ScrapedResult[]
  diagnostics: CloudflareRerankDiagnostics
}

export interface CloudflareEnvironment {
  [key: string]: string | undefined
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_AUTH_TOKEN?: string
  CLOUDFLARE_RERANK_MODEL?: string
}

interface CloudflareScore {
  id?: unknown
  index?: unknown
  score?: unknown
  relevance_score?: unknown
}

const DEFAULT_RERANK_MODEL = '@cf/baai/bge-reranker-base'
const RERANK_TIMEOUT_MS = 2_500
const MAX_RERANK_CANDIDATES = 36

function configuredToken(env: CloudflareEnvironment): string {
  return env.CLOUDFLARE_API_TOKEN?.trim() || env.CLOUDFLARE_AUTH_TOKEN?.trim() || ''
}

export function cloudflareRerankCapabilities(env: CloudflareEnvironment = process.env) {
  return {
    configured: Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && configuredToken(env)),
    model: env.CLOUDFLARE_RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL,
  }
}

function normalizeScore(value: number): number {
  if (value >= 0 && value <= 1) return value
  const sigmoid = 1 / (1 + Math.exp(-value))
  return Math.max(0, Math.min(1, sigmoid))
}

export function parseCloudflareRerankScores(value: unknown, allowedCount: number): Map<number, number> {
  const envelope = value as {
    result?: { response?: CloudflareScore[]; data?: CloudflareScore[] } | CloudflareScore[]
    response?: CloudflareScore[]
    data?: CloudflareScore[]
  }
  const result = envelope?.result
  const rawScores = Array.isArray(result)
    ? result
    : Array.isArray(result?.response)
      ? result.response
      : Array.isArray(result?.data)
        ? result.data
        : Array.isArray(envelope?.response)
          ? envelope.response
          : Array.isArray(envelope?.data)
            ? envelope.data
            : []
  const scores = new Map<number, number>()

  for (const item of rawScores) {
    const id = Number(item.id ?? item.index)
    const rawScore = Number(item.score ?? item.relevance_score)
    if (!Number.isInteger(id) || id < 0 || id >= allowedCount || !Number.isFinite(rawScore)) continue
    scores.set(id, Number(normalizeScore(rawScore).toFixed(4)))
  }

  return scores
}

function contextText(result: ScrapedResult): string {
  const evidence = result.pageValidation?.evidence?.join(' ') || ''
  const lifecycle = result.pageValidation
    ? `${result.pageValidation.availability}. ${result.pageValidation.lifecycle.status}. ${result.pageValidation.lifecycle.reason}`
    : ''
  return [result.title, result.description, result.domain, lifecycle, evidence, result.content]
    .filter(Boolean)
    .join('. ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4_000)
}

export async function rerankWithCloudflare(
  query: string,
  results: ScrapedResult[],
  env: CloudflareEnvironment = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<CloudflareRerankOutcome> {
  const startedAt = Date.now()
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() || ''
  const token = configuredToken(env)
  const model = env.CLOUDFLARE_RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL
  const configured = Boolean(accountId && token)
  const candidates = results.slice(0, MAX_RERANK_CANDIDATES)

  const baseDiagnostics: CloudflareRerankDiagnostics = {
    configured,
    used: false,
    model,
    runtimeMs: 0,
    candidateCount: candidates.length,
    scoredCount: 0,
  }

  if (!configured || candidates.length === 0) {
    return {
      results,
      diagnostics: { ...baseDiagnostics, runtimeMs: Date.now() - startedAt },
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS)
  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        contexts: candidates.map(result => ({ text: contextText(result) })),
      }),
      signal: controller.signal,
      cache: 'no-store',
    })
    const responseText = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`)

    const payload = JSON.parse(responseText) as { success?: boolean; errors?: unknown[] }
    if (payload.success === false) {
      throw new Error(`Cloudflare reported failure: ${JSON.stringify(payload.errors || []).slice(0, 400)}`)
    }
    const scores = parseCloudflareRerankScores(payload, candidates.length)
    if (scores.size === 0) throw new Error(`Cloudflare returned no usable reranker scores: ${responseText.slice(0, 500)}`)

    const adjusted = results.map((result, index) => {
      const semanticScore = scores.get(index)
      if (semanticScore === undefined) return result
      return {
        ...result,
        score: result.score + semanticScore * 48,
        semanticRerank: {
          provider: 'cloudflare' as const,
          model,
          score: semanticScore,
        },
      }
    })

    return {
      results: adjusted,
      diagnostics: {
        ...baseDiagnostics,
        used: true,
        runtimeMs: Date.now() - startedAt,
        scoredCount: scores.size,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Cloudflare semantic reranking failed; preserving local ranking:', message)
    return {
      results,
      diagnostics: {
        ...baseDiagnostics,
        runtimeMs: Date.now() - startedAt,
        error: message.slice(0, 500),
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
