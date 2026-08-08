import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as cheerio from 'cheerio'
import pdfParse from 'pdf-parse'
import Tesseract from 'tesseract.js'
import mammoth from 'mammoth'

// Server-side only: this module uses binary parsers and must not be imported
// into client components.

const execFileAsync = promisify(execFile)
const MAX_EMBEDDED_STATE_TEXT = 120_000
const EMBEDDED_PROCUREMENT_HINT = /\b(?:rfp|rfq|rfi|solicitation|procurement|bid|tender|proposal|deadline|closing date|scope of work|statement of work|occupational health|medical surveillance)\b/i

export interface ExtractedDocument {
  text: string
  title?: string
  metadata: {
    fileType?: string
    pageCount?: number
    author?: string
    createdDate?: string
    modifiedDate?: string
    ocrConfidence?: number
  }
  entities: {
    emails: string[]
    phones: string[]
    urls: string[]
    dates: string[]
    monetaryValues: string[]
  }
  sections: {
    headers: string[]
    paragraphs: string[]
    tables: string[][]
  }
  links?: Array<{
    url: string
    text: string
  }>
}

export interface ExtractionResult {
  success: boolean
  document?: ExtractedDocument
  error?: string
  source?: string
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function uniqueLinks(values: Array<{ url: string; text: string }>): Array<{ url: string; text: string }> {
  const seen = new Set<string>()
  return values.filter(link => {
    const key = link.url.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function textSections(text: string, paragraphMinimum = 30) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const headers = lines.filter(line =>
    /^(?:Chapter|Section|Part)\s+\d+/i.test(line)
    || /^[A-Z][A-Z\s]{8,}$/.test(line)
    || /^\d+\.\s+[A-Z]/.test(line)
  )
  const paragraphs = lines.filter(line => line.length >= paragraphMinimum)
  return { headers: unique(headers), paragraphs: unique(paragraphs), tables: [] as string[][] }
}

function collectEmbeddedStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 8 || output.join(' ').length >= MAX_EMBEDDED_STATE_TEXT) return
  if (typeof value === 'string') {
    const cleaned = normalizeText(value)
    if (cleaned.length >= 3 && cleaned.length <= 8_000) output.push(cleaned)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 250)) collectEmbeddedStrings(item, output, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 300)) {
    if (EMBEDDED_PROCUREMENT_HINT.test(key.replace(/[_-]+/g, ' '))) output.push(key.replace(/[_-]+/g, ' '))
    collectEmbeddedStrings(child, output, depth + 1)
    if (output.join(' ').length >= MAX_EMBEDDED_STATE_TEXT) break
  }
}

/**
 * Recover useful public evidence embedded in hydration/JSON script payloads.
 * Many procurement portals initially return a thin HTML shell while placing the
 * solicitation title, dates, identifiers, and scope in __NEXT_DATA__, JSON-LD,
 * or similar application state. We inspect bounded JSON-like scripts only; we do
 * not execute arbitrary page JavaScript.
 */
export function extractEmbeddedClientState(html: string): string {
  const $ = cheerio.load(html)
  const output: string[] = []

  $('meta[name="description"], meta[property="og:title"], meta[property="og:description"], meta[name="twitter:title"], meta[name="twitter:description"]').each((_, element) => {
    const content = normalizeText(String($(element).attr('content') || ''))
    if (content) output.push(content)
  })

  const scripts = $('script').toArray().slice(0, 80)
  for (const element of scripts) {
    if (output.join(' ').length >= MAX_EMBEDDED_STATE_TEXT) break
    const type = String($(element).attr('type') || '').toLowerCase()
    const id = String($(element).attr('id') || '').toLowerCase()
    const raw = String($(element).html() || '').trim()
    if (!raw || raw.length > 1_000_000) continue

    const jsonLike = type.includes('json')
      || id === '__next_data__'
      || id === '__nuxt_data__'
      || id.includes('initial-state')
      || id.includes('initial_state')
      || /^\s*[\[{]/.test(raw)

    if (!jsonLike) continue
    try {
      collectEmbeddedStrings(JSON.parse(raw), output)
    } catch {
      // Some portals embed a JavaScript assignment rather than strict JSON. We
      // only retain bounded raw text when it contains strong procurement terms.
      if (EMBEDDED_PROCUREMENT_HINT.test(raw)) output.push(raw.slice(0, 20_000))
    }
  }

  return normalizeText(unique(output).join(' ')).slice(0, MAX_EMBEDDED_STATE_TEXT)
}

/** Extract common public-contact and document entities without throwing. */
export function extractEntities(text: string) {
  const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
  const phones = text.match(
    /(?:\b(?:phone|tel|telephone|call)\s*[:.-]?\s*)?(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/gi
  ) || []
  const urls = text.match(
    /https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=]*)?/g
  ) || []
  const dates = text.match(
    /(?:\d{1,2}\/\d{1,2}\/\d{4})|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi
  ) || []
  const monetaryValues = text.match(/\$[\d,]+(?:\.\d{2})?|\$\d+\s*(?:million|k)/gi) || []

  return {
    emails: unique(emails),
    phones: unique(phones),
    urls: unique(urls),
    dates: unique(dates),
    monetaryValues: unique(monetaryValues),
  }
}

export function extractFromHTML(html: string, baseUrl?: string): ExtractedDocument {
  const embeddedState = extractEmbeddedClientState(html)
  const $ = cheerio.load(html)
  const links = uniqueLinks(
    $('a[href]').map((_, element) => {
      const href = String($(element).attr('href') || '').trim()
      if (!href || href.startsWith('#') || /^(?:javascript|mailto|tel):/i.test(href)) return null
      try {
        const url = baseUrl ? new URL(href, baseUrl).toString() : href
        if (!/^https?:\/\//i.test(url)) return null
        return {
          url,
          text: normalizeText($(element).text()) || normalizeText($(element).attr('title') || '') || url,
        }
      } catch {
        return null
      }
    }).get().filter((link): link is { url: string; text: string } => Boolean(link))
  )

  $('script, style, nav, header, footer, iframe, noscript').remove()

  const visibleText = normalizeText($('body').text())
  const text = normalizeText(`${visibleText} ${embeddedState}`)
  const title = normalizeText($('title').text()) || normalizeText($('h1').first().text()) || undefined
  const headers: string[] = []
  const paragraphs: string[] = []
  const tables: string[][] = []

  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const header = normalizeText($(element).text())
    if (header) headers.push(header)
  })
  $('p').each((_, element) => {
    const paragraph = normalizeText($(element).text())
    if (paragraph.length > 20) paragraphs.push(paragraph)
  })
  $('table').each((_, element) => {
    const cells = $(element).find('td, th')
      .map((__, cell) => normalizeText($(cell).text()))
      .get()
      .filter(Boolean)
    if (cells.length) tables.push(cells)
  })

  const entities = extractEntities(text)
  entities.urls = unique([...entities.urls, ...links.map(link => link.url)])

  return {
    text,
    title,
    metadata: { fileType: embeddedState && visibleText.length < 180 ? 'html-client-state' : 'html' },
    entities,
    sections: {
      headers: unique(headers),
      paragraphs: unique([...paragraphs, ...(embeddedState ? [embeddedState] : [])]),
      tables,
    },
    links,
  }
}

function withTimeout<T>(promise: Promise<T>, timeout: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeout)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export function isOCREnabled(): boolean {
  return process.env.ENABLE_OCR === 'true'
}

export async function extractScannedPdfWithOcr(
  buffer: Buffer,
  timeout = 9_000,
  maxPages = 2
): Promise<ExtractionResult> {
  if (!isOCREnabled()) return { success: false, error: 'OCR is disabled. Set ENABLE_OCR=true to enable.' }

  const startedAt = Date.now()
  const safeMaxPages = Math.max(1, Math.min(maxPages, 3))
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ultra-search-pdf-ocr-'))
  const inputPath = path.join(tempDir, 'input.pdf')
  const outputPrefix = path.join(tempDir, 'page')
  let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | undefined

  try {
    await writeFile(inputPath, buffer)
    const executable = process.env.PDFTOPPM_PATH || 'pdftoppm'
    const renderBudget = Math.max(1_500, Math.min(4_000, timeout - 2_000))
    await execFileAsync(executable, [
      '-f', '1',
      '-l', String(safeMaxPages),
      '-png',
      '-r', '120',
      inputPath,
      outputPrefix,
    ], { timeout: renderBudget, maxBuffer: 1024 * 1024 })

    const pageFiles = (await readdir(tempDir))
      .filter(file => /^page-\d+\.png$/i.test(file))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .slice(0, safeMaxPages)
    if (pageFiles.length === 0) return { success: false, error: 'PDF OCR renderer produced no page images' }

    worker = await Tesseract.createWorker('eng', 1)
    const texts: string[] = []
    const confidences: number[] = []
    for (const file of pageFiles) {
      const remaining = timeout - (Date.now() - startedAt)
      if (remaining < 1_000) break
      const image = await readFile(path.join(tempDir, file))
      const recognized = await withTimeout(worker.recognize(image), Math.min(remaining, 5_000), 'Scanned PDF OCR')
      const text = normalizeText(recognized.data.text)
      if (text) texts.push(text)
      if (Number.isFinite(recognized.data.confidence)) confidences.push(recognized.data.confidence)
    }

    const text = normalizeText(texts.join(' '))
    if (text.length < 10) return { success: false, error: 'Scanned PDF OCR returned insufficient text' }
    const confidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : undefined

    return {
      success: true,
      document: {
        text,
        title: texts[0]?.slice(0, 180),
        metadata: { fileType: 'pdf-ocr', pageCount: pageFiles.length, ocrConfidence: confidence },
        entities: extractEntities(text),
        sections: textSections(text, 30),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: `Scanned PDF OCR unavailable: ${message}` }
  } finally {
    await worker?.terminate().catch(() => undefined)
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function extractFromPDFBuffer(
  buffer: Buffer,
  options: { ocrTimeoutMs?: number; ocrMaxPages?: number } = {}
): Promise<ExtractionResult> {
  try {
    const data = await pdfParse(buffer)
    const text = normalizeText(data.text)
    if (text.length < 180 && isOCREnabled()) {
      const ocr = await extractScannedPdfWithOcr(
        buffer,
        options.ocrTimeoutMs ?? 9_000,
        Math.min(options.ocrMaxPages ?? 2, data.numpages || 2)
      )
      if (ocr.success && ocr.document && ocr.document.text.length > text.length) {
        return {
          success: true,
          document: {
            ...ocr.document,
            metadata: {
              ...ocr.document.metadata,
              pageCount: data.numpages,
              author: data.info?.Author,
              createdDate: data.info?.CreationDate,
              modifiedDate: data.info?.ModDate,
            },
          },
        }
      }
    }

    const title = data.text.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    return {
      success: true,
      document: {
        text,
        title,
        metadata: {
          fileType: 'pdf',
          pageCount: data.numpages,
          author: data.info?.Author,
          createdDate: data.info?.CreationDate,
          modifiedDate: data.info?.ModDate,
        },
        entities: extractEntities(text),
        sections: textSections(data.text, 50),
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'PDF parsing failed' }
  }
}

export function extractFromPDFText(pdfText: string, metadata?: any): ExtractedDocument {
  const text = normalizeText(pdfText)
  const title = pdfText.split(/\r?\n/).map(line => line.trim()).find(Boolean)
  return {
    text,
    title,
    metadata: {
      fileType: 'pdf',
      pageCount: metadata?.numPages,
      author: metadata?.info?.Author,
      createdDate: metadata?.info?.CreationDate,
      modifiedDate: metadata?.info?.ModDate,
    },
    entities: extractEntities(text),
    sections: textSections(pdfText, 50),
  }
}

export async function extractFromDOCXBuffer(buffer: Buffer, timeout = 10_000): Promise<ExtractionResult> {
  try {
    const result = await withTimeout(mammoth.extractRawText({ buffer }), timeout, 'DOCX parsing')
    const text = normalizeText(result.value)
    if (text.length < 10) return { success: false, error: 'DOCX extraction returned insufficient text' }

    return {
      success: true,
      document: {
        text,
        title: result.value.split(/\r?\n/).map(line => line.trim()).find(Boolean),
        metadata: { fileType: 'docx' },
        entities: extractEntities(text),
        sections: textSections(result.value),
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'DOCX parsing failed' }
  }
}

export function extractFromDOCXText(docxContent: string): ExtractedDocument {
  const text = normalizeText(docxContent)
  return {
    text,
    title: docxContent.split(/\r?\n/).map(line => line.trim()).find(Boolean),
    metadata: { fileType: 'docx' },
    entities: extractEntities(text),
    sections: textSections(docxContent),
  }
}

export async function extractFromImage(imageBuffer: Buffer, timeout = 30_000): Promise<ExtractionResult> {
  if (!isOCREnabled()) {
    return { success: false, error: 'OCR is disabled. Set ENABLE_OCR=true to enable.' }
  }

  let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | undefined
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      logger: message => {
        if (message.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(message.progress * 100)}%`)
        }
      },
    })
    const result = await withTimeout(worker.recognize(imageBuffer), timeout, 'OCR operation')
    const text = normalizeText(result.data.text)
    if (text.length < 10) return { success: false, error: 'OCR returned insufficient text' }

    return {
      success: true,
      document: {
        text,
        title: result.data.text.split(/\r?\n/).map(line => line.trim()).find(Boolean),
        metadata: { fileType: 'image', ocrConfidence: result.data.confidence },
        entities: extractEntities(text),
        sections: textSections(result.data.text, 20),
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'OCR processing failed' }
  } finally {
    await worker?.terminate().catch(() => undefined)
  }
}

export async function fetchAndExtractFromURL(
  url: string,
  timeout = 10_000,
  fetchImpl: typeof fetch = fetch
): Promise<ExtractionResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}`, source: url }
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
      const result = await extractFromPDFBuffer(Buffer.from(await response.arrayBuffer()), { ocrTimeoutMs: Math.min(timeout, 9_000) })
      return { ...result, source: url }
    }
    if (contentType.includes('wordprocessingml.document') || url.toLowerCase().endsWith('.docx')) {
      const result = await extractFromDOCXBuffer(Buffer.from(await response.arrayBuffer()), timeout)
      return { ...result, source: url }
    }
    if (contentType.includes('image/') || /\.(png|jpg|jpeg|gif|bmp|tiff|webp)$/i.test(url)) {
      const result = await extractFromImage(Buffer.from(await response.arrayBuffer()), timeout)
      return { ...result, source: url }
    }

    const baseUrl = response.url || url
    return { success: true, document: extractFromHTML(await response.text(), baseUrl), source: url }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Fetch failed', source: url }
  } finally {
    clearTimeout(timer)
  }
}

export async function extractDocument(
  content: string,
  fileType: 'html' | 'pdf' | 'docx' | 'text',
  metadata?: any
): Promise<ExtractedDocument> {
  if (fileType === 'html') return extractFromHTML(content)
  if (fileType === 'pdf') return extractFromPDFText(content, metadata)
  if (fileType === 'docx') return extractFromDOCXText(content)

  const text = normalizeText(content)
  return {
    text,
    metadata: { fileType: fileType || 'unknown' },
    entities: extractEntities(text),
    sections: { headers: [], paragraphs: text ? [text] : [], tables: [] },
  }
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0
  let count = 0
  let position = 0
  while ((position = text.indexOf(term, position)) >= 0) {
    count += 1
    position += term.length
  }
  return count
}

export function scoreDocumentRelevance(
  document: ExtractedDocument,
  query: string,
  lens: string
): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = document.text.toLowerCase()
  const title = document.title?.toLowerCase() || ''
  let score = 0

  for (const term of queryTerms) {
    score += countOccurrences(text, term) * 5
    if (title.includes(term)) score += 20
  }

  if (lens === 'procurement') {
    if (document.entities.dates.length) score += 15
    if (document.entities.monetaryValues.length) score += 15
    if (text.includes('rfp') || text.includes('solicitation')) score += 30
  } else if (lens === 'pricing') {
    if (document.entities.monetaryValues.length) score += 25
    if (/\b(?:fee|price|rate)\b/.test(text)) score += 20
  } else if (lens === 'provider') {
    if (document.entities.phones.length) score += 15
    if (document.entities.emails.length) score += 10
    if (/\b(?:clinic|provider)\b/.test(text)) score += 20
  }

  if (document.sections.headers.length > 3) score += 10
  if (document.sections.tables.length) score += 15
  return Math.min(100, score)
}
