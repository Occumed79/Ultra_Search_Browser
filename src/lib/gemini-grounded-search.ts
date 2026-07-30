import type { ScrapedResult, SearchLens } from '../types/search'
import { normalizeGeminiModel } from './semantic-intent'

export interface GeminiGroundedSearchEnvironment {
  [key: string]: string | undefined
  GEMINI_API_KEY?: string
  GEMINI_SEARCH_MODEL?: string
  GEMINI_INTENT_MODEL?: string
  GEMINI_MODEL?: string
}

export interface GeminiGroundedSearchDiagnostics {
  configured: boolean
  model: string
  attempted: boolean
  successful: boolean
  resultCount: number
  runtimeMs: number
  searchQueries: string[]
  error?: string
}

interface GroundingWebChunk {
  uri?: unknown
  title?: unknown
}

interface GroundingChunk {
  web?: GroundingWebChunk
}

interface GroundingSupport {
  segment?: {
    text?: unknown
    startIndex?: unknown
    endIndex?: unknown
  }
  groundingChunkIndices?: unknown
}

interface GroundingMetadata {
  groundingChunks?: unknown
  groundingSupports?: unknown
  webSearchQueries?: unknown
}

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: unknown }>
  }
  groundingMetadata?: GroundingMetadata
}

interface GeminiEnvelope {
  candidates?: GeminiCandidate[]
  error?: {
    message?: unknown
  }
}

type SearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const SEARCH_TIMEOUT_MS = 12_000
const MAX_RESULTS = 20

function searchModel(environment: GeminiGroundedSearchEnvironment): string {
  return normalizeGeminiModel(
    environment.GEMINI_SEARCH_MODEL?.trim()
    || environment.GEMINI_INTENT_MODEL?.trim()
    || environment.GEMINI_MODEL?.trim()
    || DEFAULT_MODEL
  )
}

export function geminiGroundedSearchCapabilities(
  environment: GeminiGroundedSearchEnvironment = process.env
): { configured: boolean; model: string } {
  return {
    configured: Boolean(environment.GEMINI_API_KEY?.trim()),
    model: searchModel(environment),
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of value) {
    const text = stringValue(item)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    output.push(text)
  }
  return output
}

function groundingChunks(value: unknown): GroundingChunk[] {
  return Array.isArray(value)
    ? value.filter((item): item is GroundingChunk => Boolean(item && typeof item === 'object'))
    : []
}

function groundingSupports(value: unknown): GroundingSupport[] {
  return Array.isArray(value)
    ? value.filter((item): item is GroundingSupport => Boolean(item && typeof item === 'object'))
    : []
}

function supportDescriptions(metadata: GroundingMetadata): Map<number, string[]> {
  const descriptions = new Map<number, string[]>()
  for (const support of groundingSupports(metadata.groundingSupports)) {
    const segment = stringValue(support.segment?.text)
    if (!segment || !Array.isArray(support.groundingChunkIndices)) continue
    for (const rawIndex of support.groundingChunkIndices) {
      const index = Number(rawIndex)
      if (!Number.isInteger(index) || index < 0) continue
      const values = descriptions.get(index) || []
      if (!values.some(value => value.toLowerCase() === segment.toLowerCase())) {
        values.push(segment)
      }
      descriptions.set(index, values)
    }
  }
  return descriptions
}

function normalizeGroundedResults(
  metadata: GroundingMetadata,
  query: string,
  answerText: string
): ScrapedResult[] {
  const descriptions = supportDescriptions(metadata)
  const seenUrls = new Set<string>()
  const results: ScrapedResult[] = []

  for (const [index, chunk] of groundingChunks(metadata.groundingChunks).entries()) {
    const uri = stringValue(chunk.web?.uri)
    const suppliedTitle = stringValue(chunk.web?.title)
    if (!uri) continue

    try {
      const parsed = new URL(uri)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue
      parsed.hash = ''
      const normalizedUrl = parsed.toString().replace(/\/$/, '')
      const dedupeKey = normalizedUrl.toLowerCase()
      if (seenUrls.has(dedupeKey)) continue
      seenUrls.add(dedupeKey)

      const evidence = descriptions.get(index)?.join(' ') || ''
      const title = suppliedTitle || parsed.hostname.replace(/^www\./, '')
      results.push({
        title,
        url: normalizedUrl,
        description: (evidence || answerText).slice(0, 1_200),
        domain: parsed.hostname.replace(/^www\./, ''),
        source: 'Gemini Google Search',
        rank: results.length + 1,
        score: 0,
        retrieval: {
          sources: ['Gemini Google Search'],
          queries: [query],
          purposes: ['grounded-web-discovery'],
          overlap: 1,
        },
      })
      if (results.length >= MAX_RESULTS) break
    } catch {
      // Ignore malformed grounding URLs while preserving all valid sources.
    }
  }

  return results
}

function searchPrompt(query: string, lens: SearchLens): string {
  return [
    'Use Google Search to find real public webpages that directly satisfy the user request below.',
    'This is a search-engine retrieval step, not a general question-answering step.',
    'Return a compact source roundup with one short factual line per useful page so every page is cited in the grounding metadata.',
    'Favor direct official pages, substantive documents, active procurement pages, provider websites, and other primary sources when relevant.',
    'Exclude generic dictionary definitions, thin indexes, unrelated pages, and fabricated URLs.',
    'Preserve the complete meaning of the exact query. Do not silently search only one word from it.',
    `Search lens: ${lens}`,
    `Exact user query: ${query}`,
  ].join('\n')
}

export async function searchGeminiGroundedWeb(
  query: string,
  lens: SearchLens,
  environment: GeminiGroundedSearchEnvironment = process.env,
  fetchImpl: SearchFetch = fetch
): Promise<{
  text: string
  results: ScrapedResult[]
  diagnostics: GeminiGroundedSearchDiagnostics
}> {
  const startedAt = Date.now()
  const apiKey = environment.GEMINI_API_KEY?.trim()
  const model = searchModel(environment)

  if (!apiKey) {
    return {
      text: '',
      results: [],
      diagnostics: {
        configured: false,
        model,
        attempted: false,
        successful: false,
        resultCount: 0,
        runtimeMs: Date.now() - startedAt,
        searchQueries: [],
      },
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
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
          contents: [{ role: 'user', parts: [{ text: searchPrompt(query, lens) }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2_400,
          },
        }),
        signal: controller.signal,
        cache: 'no-store',
      }
    )

    const responseText = await response.text()
    let envelope: GeminiEnvelope = {}
    try {
      envelope = responseText ? JSON.parse(responseText) as GeminiEnvelope : {}
    } catch {
      throw new Error('Gemini Google Search returned malformed JSON')
    }

    if (!response.ok) {
      const upstreamMessage = stringValue(envelope.error?.message)
      throw new Error(`HTTP ${response.status}${upstreamMessage ? `: ${upstreamMessage.slice(0, 300)}` : ''}`)
    }

    const candidate = envelope.candidates?.[0]
    const answerText = candidate?.content?.parts
      ?.map(part => stringValue(part.text))
      .filter(Boolean)
      .join(' ')
      .trim() || ''
    const metadata = candidate?.groundingMetadata || {}
    const results = normalizeGroundedResults(metadata, query, answerText)
    const searchQueries = stringArray(metadata.webSearchQueries)

    if (!results.length) {
      throw new Error('Gemini Google Search returned no grounded web sources')
    }

    return {
      text: [answerText, ...results.flatMap(result => [result.title, result.description, result.url])]
        .filter(Boolean)
        .join(' '),
      results,
      diagnostics: {
        configured: true,
        model,
        attempted: true,
        successful: true,
        resultCount: results.length,
        runtimeMs: Date.now() - startedAt,
        searchQueries,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      text: '',
      results: [],
      diagnostics: {
        configured: true,
        model,
        attempted: true,
        successful: false,
        resultCount: 0,
        runtimeMs: Date.now() - startedAt,
        searchQueries: [],
        error: message.slice(0, 500),
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
