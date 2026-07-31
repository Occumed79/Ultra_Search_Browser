import { fetchAndExtractFromURL, type ExtractedDocument } from './document-extraction'
import { classifyResultStatus, type ResultStatusAssessment } from './result-status'
import type { SolicitationDocumentEvidence } from './rfp-opportunity-intelligence'

export interface SolicitationPackageAnalysis {
  documents: SolicitationDocumentEvidence[]
  combinedText: string
  lifecycle: ResultStatusAssessment
  discoveredCount: number
  inspectedCount: number
  failedCount: number
  latestDeadline?: string
}

interface PackageOptions {
  maxAttachments?: number
  attachmentTimeoutMs?: number
  maxCombinedText?: number
  fetchImpl?: typeof fetch
}

const PROCUREMENT_LINK_TEXT = /\b(?:rfp|rfq|rfi|ifb|solicitation|invitation to bid|bid documents?|request for proposals?|request for quotations?|attachment|amendment|addendum|exhibit|appendix|scope of work|statement of work|specifications?|pricing|price sheet|questions? and answers?|q\s*&\s*a|clarification|terms and conditions)\b/i
const DOCUMENT_EXTENSION = /\.(?:pdf|docx?)(?:$|[?#])/i

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

function safePublicUrl(value: string, baseUrl: string): URL | undefined {
  try {
    const parsed = new URL(value, baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
    if (parsed.username || parsed.password) return undefined
    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || isPrivateIpv4(host)
      || host === '::1'
      || host === '::'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || /^fe[89ab]/.test(host)
    ) return undefined
    parsed.hash = ''
    return parsed
  } catch {
    return undefined
  }
}

function documentKind(value: string): SolicitationDocumentEvidence['kind'] {
  const normalized = value.toLowerCase()
  if (/\bamendment\b/.test(normalized)) return 'amendment'
  if (/\baddendum\b/.test(normalized)) return 'addendum'
  if (/\bquestions?\b|\bq\s*&\s*a\b|\bclarification\b/.test(normalized)) return 'questions'
  if (/\bpricing\b|\bprice sheet\b|\bbid schedule\b/.test(normalized)) return 'pricing'
  if (/\bscope of work\b|\bstatement of work\b|\bsow\b|\bspecification/.test(normalized)) return 'scope'
  if (/\brfp\b|request for proposals?/.test(normalized)) return 'rfp'
  if (/\battachment\b|\bexhibit\b|\bappendix\b/.test(normalized)) return 'attachment'
  return 'other'
}

function scoreLink(url: URL, label: string, primary: URL): number {
  const combined = `${label} ${url.pathname} ${url.search}`
  let score = 0
  if (DOCUMENT_EXTENSION.test(url.toString())) score += 40
  if (PROCUREMENT_LINK_TEXT.test(combined)) score += 35
  if (/\b(?:amendment|addendum|questions?|clarification)\b/i.test(combined)) score += 25
  if (url.hostname === primary.hostname) score += 18
  if (/\b(?:download|document|attachment|solicitation)\b/i.test(url.pathname)) score += 10
  if (/\b(?:login|register|sign-in|vendor-registration)\b/i.test(combined)) score -= 40
  return score
}

function discoverLinks(primaryUrl: string, document: ExtractedDocument): Array<{ url: string; label: string; score: number }> {
  const primary = safePublicUrl(primaryUrl, primaryUrl)
  if (!primary) return []
  const candidates = [
    ...(document.links || []).map(link => ({ url: link.url, label: link.text || link.url })),
    ...document.entities.urls.map(url => ({ url, label: url })),
  ]
  const seen = new Set<string>()
  return candidates.flatMap(candidate => {
    const parsed = safePublicUrl(candidate.url, primaryUrl)
    if (!parsed) return []
    const normalized = parsed.toString().replace(/\/$/, '')
    const key = normalized.toLowerCase()
    if (key === primary.toString().replace(/\/$/, '').toLowerCase() || seen.has(key)) return []
    seen.add(key)
    const score = scoreLink(parsed, candidate.label, primary)
    if (score < 35) return []
    return [{ url: normalized, label: clean(candidate.label).slice(0, 180), score }]
  }).sort((left, right) => right.score - left.score)
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  async function run() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, () => run()))
  return output
}

function latestDeadline(lifecycle: ResultStatusAssessment): string | undefined {
  return lifecycle.dates
    .filter(date => ['due', 'closing', 'expiration'].includes(date.kind) && date.iso)
    .map(date => date.iso?.slice(0, 10))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
}

export async function inspectSolicitationPackage(
  primaryUrl: string,
  primaryDocument: ExtractedDocument,
  options: PackageOptions = {}
): Promise<SolicitationPackageAnalysis> {
  const maxAttachments = Math.max(0, Math.min(options.maxAttachments ?? 4, 6))
  const timeoutMs = Math.max(1_500, Math.min(options.attachmentTimeoutMs ?? 4_500, 8_000))
  const maxCombinedText = Math.max(40_000, Math.min(options.maxCombinedText ?? 180_000, 260_000))
  const links = discoverLinks(primaryUrl, primaryDocument)
  const selected = links.slice(0, maxAttachments)
  const documents: SolicitationDocumentEvidence[] = [{
    url: primaryUrl,
    title: primaryDocument.title,
    kind: 'primary',
    extracted: true,
    textLength: primaryDocument.text.length,
    contentType: primaryDocument.metadata.fileType,
  }]
  const extractedTexts: string[] = [primaryDocument.text]

  const inspected = await mapWithConcurrency(selected, 2, async candidate => {
    const result = await fetchAndExtractFromURL(candidate.url, timeoutMs, options.fetchImpl)
    if (!result.success || !result.document) {
      return {
        evidence: {
          url: candidate.url,
          title: candidate.label,
          kind: documentKind(`${candidate.label} ${candidate.url}`),
          extracted: false,
          textLength: 0,
          reason: result.error || 'Attachment extraction failed.',
        } satisfies SolicitationDocumentEvidence,
        text: '',
      }
    }

    return {
      evidence: {
        url: candidate.url,
        title: result.document.title || candidate.label,
        kind: documentKind(`${candidate.label} ${candidate.url} ${result.document.title || ''}`),
        extracted: true,
        textLength: result.document.text.length,
        contentType: result.document.metadata.fileType,
      } satisfies SolicitationDocumentEvidence,
      text: result.document.text,
    }
  })

  for (const item of inspected) {
    documents.push(item.evidence)
    if (item.text) extractedTexts.push(item.text)
  }

  const combinedText = clean(extractedTexts.join('\n\n')).slice(0, maxCombinedText)
  const lifecycle = classifyResultStatus(combinedText, 'procurement')
  return {
    documents,
    combinedText,
    lifecycle,
    discoveredCount: links.length,
    inspectedCount: inspected.filter(item => item.evidence.extracted).length,
    failedCount: inspected.filter(item => !item.evidence.extracted).length,
    latestDeadline: latestDeadline(lifecycle),
  }
}
