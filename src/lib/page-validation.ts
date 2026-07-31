import { createHash } from 'node:crypto'
import {
  extractFromDOCXBuffer,
  extractFromHTML,
  extractFromPDFBuffer,
  type ExtractedDocument,
} from './document-extraction'
import { classifyResultStatus, type ResultStatusAssessment } from './result-status'
import {
  extractRfpOpportunityIntelligence,
  type RfpOpportunityIntelligence,
} from './rfp-opportunity-intelligence'
import {
  inspectSolicitationPackage,
  type SolicitationPackageAnalysis,
} from './solicitation-package'
import type { ScrapedResult, SearchLens } from '../types/search'

export type PageAvailability =
  | 'reachable'
  | 'dead'
  | 'blocked'
  | 'login'
  | 'generic'
  | 'search-page'
  | 'thin'
  | 'unsupported'
  | 'error'

export interface PageValidationResult {
  checkedAt: string
  requestedUrl: string
  finalUrl: string
  httpStatus?: number
  contentType?: string
  availability: PageAvailability
  reason: string
  evidence: string[]
  extractedText: string
  extractedTextLength: number
  title?: string
  contentHash?: string
  cached: boolean
  lifecycle: ResultStatusAssessment
  packageAnalysis?: SolicitationPackageAnalysis
  rfpIntelligence?: RfpOpportunityIntelligence
}

export interface PageSignalAssessment {
  availability: PageAvailability
  reason: string
}

interface CacheEntry {
  expiresAt: number
  value: PageValidationResult
}

const PAGE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024
const MAX_EXTRACTED_TEXT = 180_000
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000
const MAX_REDIRECTS = 5
const cache = new Map<string, CacheEntry>()

const REQUEST_HEADERS = {
  'User-Agent': 'UltraSearchBrowser/1.0 evidence-validator (+https://ultra-search-browser.onrender.com)',
  Accept: 'text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain;q=0.9,*/*;q=0.2',
  'Accept-Language': 'en-US,en;q=0.8',
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isPrivateIpv4(host: string): boolean {
  return host === '0.0.0.0'
    || host === '127.0.0.1'
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host)
    || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
}

function safeUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (parsed.username || parsed.password) return undefined
    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || isPrivateIpv4(host)
      || isPrivateIpv6(host)
    ) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function cacheKey(url: string): string {
  const parsed = safeUrl(url)
  if (!parsed) return url.trim().toLowerCase()
  parsed.hash = ''
  for (const key of Array.from(parsed.searchParams.keys())) {
    const lower = key.toLowerCase()
    if (lower.startsWith('utm_') || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(lower)) parsed.searchParams.delete(key)
  }
  return parsed.toString().replace(/\/$/, '').toLowerCase()
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isDocumentType(contentType: string, url: string): 'pdf' | 'docx' | 'html' | 'unsupported' {
  const normalized = `${contentType} ${url}`.toLowerCase()
  if (normalized.includes('application/pdf') || /\.pdf(?:$|[?#])/.test(normalized)) return 'pdf'
  if (normalized.includes('wordprocessingml') || /\.docx(?:$|[?#])/.test(normalized)) return 'docx'
  if (normalized.includes('text/html') || normalized.includes('application/xhtml') || normalized.includes('text/plain') || !contentType) return 'html'
  return 'unsupported'
}

function looksLikeGenericRedirect(requested: URL, finalUrl: URL): boolean {
  const requestedPath = requested.pathname.replace(/\/+$/, '')
  const finalPath = finalUrl.pathname.replace(/\/+$/, '')
  if (!requestedPath || requestedPath === '/') return false
  return (!finalPath || finalPath === '/') && requestedPath.split('/').filter(Boolean).length >= 1
}

export function inspectPageSignals(
  text: string,
  finalUrl: string,
  requestedUrl = finalUrl,
  title = ''
): PageSignalAssessment {
  const normalized = clean(`${title} ${text}`).toLowerCase()
  const final = safeUrl(finalUrl)
  const requested = safeUrl(requestedUrl)

  if (requested && final && looksLikeGenericRedirect(requested, final)) {
    return { availability: 'generic', reason: 'The result redirected to a generic site homepage instead of the requested page.' }
  }
  if (/\b(?:access denied|request blocked|attention required|verify you are human|checking your browser|captcha|cloudflare ray id|unusual traffic|bot detection)\b/.test(normalized)) {
    return { availability: 'blocked', reason: 'The destination returned a bot challenge or access-denied page.' }
  }
  if (/\b(?:sign in to continue|log in to continue|authentication required|please sign in|member login|account login)\b/.test(normalized) && normalized.length < 8_000) {
    return { availability: 'login', reason: 'The destination is a login wall rather than public supporting evidence.' }
  }
  if (
    final
    && /(?:^|\/)(?:search|search-results|results)(?:\/|$)/i.test(final.pathname)
    && /\bsearch results?\b/.test(normalized)
  ) {
    return { availability: 'search-page', reason: 'The destination is another search-results page rather than a substantive source.' }
  }
  if (/\b(?:page not found|404 not found|content unavailable|this page has moved|the requested page could not be found)\b/.test(normalized) && normalized.length < 15_000) {
    return { availability: 'dead', reason: 'The destination content says the page is missing or unavailable.' }
  }
  if (clean(text).length < 180) {
    return { availability: 'thin', reason: 'The destination returned too little readable content to validate the result.' }
  }
  return { availability: 'reachable', reason: 'The destination is reachable and contains substantive public content.' }
}

function evidenceExcerpts(text: string, query: string, lifecycle: ResultStatusAssessment): string[] {
  const normalized = clean(text)
  if (!normalized) return []
  const terms = Array.from(new Set([
    ...query.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length >= 4),
    'deadline', 'due date', 'scope of work', 'medical', 'occupational', 'solicitation',
  ]))
  const lower = normalized.toLowerCase()
  const excerpts: string[] = []

  for (const term of terms) {
    const index = lower.indexOf(term)
    if (index < 0) continue
    const excerpt = clean(normalized.slice(Math.max(0, index - 90), Math.min(normalized.length, index + 260)))
    if (excerpt && !excerpts.some(item => item.includes(excerpt) || excerpt.includes(item))) excerpts.push(excerpt)
    if (excerpts.length >= 4) break
  }

  for (const date of lifecycle.dates.slice(0, 3)) {
    if (date.context && !excerpts.includes(date.context)) excerpts.push(date.context)
    if (excerpts.length >= 6) break
  }

  if (excerpts.length === 0) excerpts.push(normalized.slice(0, 360))
  return excerpts.slice(0, 6)
}

async function extractResponse(
  response: Response,
  type: 'pdf' | 'docx' | 'html',
  baseUrl: string
): Promise<ExtractedDocument> {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`)

  if (type === 'html') {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`)
    return extractFromHTML(text, baseUrl)
  }

  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`)
  const buffer = Buffer.from(bytes)
  const extraction = type === 'pdf'
    ? await extractFromPDFBuffer(buffer)
    : await extractFromDOCXBuffer(buffer, PAGE_TIMEOUT_MS)
  if (!extraction.success || !extraction.document) throw new Error(extraction.error || `${type.toUpperCase()} extraction failed`)
  return extraction.document
}

async function fetchWithSafeRedirects(
  initialUrl: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: string }> {
  let current = initialUrl
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: REQUEST_HEADERS,
      signal,
      cache: 'no-store',
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: current.toString() }
    }

    const location = response.headers.get('location')
    if (!location) throw new Error(`Redirect HTTP ${response.status} did not include a Location header`)
    const next = safeUrl(new URL(location, current).toString())
    if (!next) throw new Error('Redirect target is invalid or points to a private/local address')
    current = next
  }
  throw new Error(`Destination exceeded ${MAX_REDIRECTS} redirects`)
}

function failureResult(
  result: ScrapedResult,
  availability: PageAvailability,
  reason: string,
  lifecycleStatus: ResultStatusAssessment['status'] = availability === 'dead' ? 'dead' : 'unknown',
  httpStatus?: number,
  finalUrl = result.url,
  contentType?: string
): PageValidationResult {
  return {
    checkedAt: new Date().toISOString(),
    requestedUrl: result.url,
    finalUrl,
    httpStatus,
    contentType,
    availability,
    reason,
    evidence: [],
    extractedText: '',
    extractedTextLength: 0,
    cached: false,
    lifecycle: {
      status: lifecycleStatus,
      reason,
      confidence: availability === 'dead' ? 0.98 : 0.7,
      dates: [],
    },
  }
}

export async function validateCandidatePage(
  result: ScrapedResult,
  lens: SearchLens,
  query: string,
  options: {
    timeoutMs?: number
    bypassCache?: boolean
    fetchImpl?: typeof fetch
    inspectPackage?: boolean
  } = {}
): Promise<PageValidationResult> {
  const key = cacheKey(result.url)
  const cached = cache.get(key)
  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true }
  }

  const requested = safeUrl(result.url)
  if (!requested) return failureResult(result, 'error', 'The result URL is invalid or points to a private/local address.')

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? PAGE_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const fetchImpl = options.fetchImpl ?? fetch

  try {
    const fetched = await fetchWithSafeRedirects(requested, fetchImpl, controller.signal)
    const response = fetched.response
    const finalUrl = fetched.finalUrl
    const contentType = response.headers.get('content-type') || ''
    if (response.status === 404 || response.status === 410) {
      return failureResult(result, 'dead', `The destination returned HTTP ${response.status}.`, 'dead', response.status, finalUrl, contentType)
    }
    if (response.status === 401) {
      return failureResult(result, 'login', 'The destination requires authentication (HTTP 401).', 'junk', response.status, finalUrl, contentType)
    }
    if (response.status === 403) {
      return failureResult(result, 'error', 'The destination denied automated access (HTTP 403), so it could not be verified.', 'unknown', response.status, finalUrl, contentType)
    }
    if (!response.ok) {
      return failureResult(result, 'error', `The destination returned HTTP ${response.status}.`, 'unknown', response.status, finalUrl, contentType)
    }

    const type = isDocumentType(contentType, finalUrl)
    if (type === 'unsupported') {
      return failureResult(result, 'unsupported', `Unsupported content type: ${contentType || 'unknown'}.`, 'unknown', response.status, finalUrl, contentType)
    }

    const document = await extractResponse(response, type, finalUrl)
    const primaryText = clean(document.text).slice(0, MAX_EXTRACTED_TEXT)
    const signal = inspectPageSignals(primaryText, finalUrl, result.url, document.title || result.title)
    let packageAnalysis: SolicitationPackageAnalysis | undefined

    if (
      lens === 'procurement'
      && signal.availability === 'reachable'
      && options.inspectPackage !== false
    ) {
      try {
        packageAnalysis = await inspectSolicitationPackage(finalUrl, document, {
          maxAttachments: 4,
          attachmentTimeoutMs: 4_500,
          maxCombinedText: MAX_EXTRACTED_TEXT,
          fetchImpl,
        })
      } catch (error) {
        console.warn('Solicitation package inspection failed:', finalUrl, error)
      }
    }

    const extractedText = clean(packageAnalysis?.combinedText || primaryText).slice(0, MAX_EXTRACTED_TEXT)
    const lifecycle = signal.availability === 'reachable'
      ? (packageAnalysis?.lifecycle || classifyResultStatus(`${document.title || ''} ${extractedText}`, lens))
      : {
          status: signal.availability === 'dead' ? 'dead' as const : 'junk' as const,
          reason: signal.reason,
          confidence: 0.94,
          dates: [],
        }
    const rfpIntelligence = lens === 'procurement' && signal.availability === 'reachable'
      ? extractRfpOpportunityIntelligence({
          text: extractedText,
          title: document.title || result.title,
          url: finalUrl,
          lifecycle,
          documents: packageAnalysis?.documents,
        })
      : undefined

    const value: PageValidationResult = {
      checkedAt: new Date().toISOString(),
      requestedUrl: result.url,
      finalUrl,
      httpStatus: response.status,
      contentType,
      availability: signal.availability,
      reason: packageAnalysis && packageAnalysis.inspectedCount > 0
        ? `${signal.reason} Inspected ${packageAnalysis.inspectedCount} linked solicitation document${packageAnalysis.inspectedCount === 1 ? '' : 's'}.`
        : signal.reason,
      evidence: evidenceExcerpts(extractedText, query, lifecycle),
      extractedText,
      extractedTextLength: extractedText.length,
      title: document.title,
      contentHash: extractedText ? hashText(extractedText) : undefined,
      cached: false,
      lifecycle,
      packageAnalysis,
      rfpIntelligence,
    }

    cache.set(key, { expiresAt: Date.now() + PAGE_CACHE_TTL_MS, value })
    if (cache.size > 500) {
      for (const [entryKey, entry] of cache) {
        if (entry.expiresAt <= Date.now()) cache.delete(entryKey)
        if (cache.size <= 400) break
      }
    }
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = /abort/i.test(message) ? `Page validation timed out after ${timeoutMs}ms.` : `Page validation failed: ${message}`
    return failureResult(result, 'error', reason)
  } finally {
    clearTimeout(timer)
  }
}

export function pageValidationCacheStats() {
  const now = Date.now()
  let active = 0
  for (const entry of cache.values()) if (entry.expiresAt > now) active += 1
  return { active, total: cache.size, ttlMs: PAGE_CACHE_TTL_MS }
}
