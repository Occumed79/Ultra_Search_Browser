/**
 * OCR.space recovery for public procurement PDFs.
 * Never persist or log API keys or uploaded document text.
 * Requests are atomically reserved in the app-owned Neon database per key/day.
 */
import { createHash } from 'node:crypto'
import { hasDatabase, query } from './db'
import { providerKeyCount, rotatingProviderKeys } from './provider-key-pool'

const OCR_KEYS = ['OCR_API_KEY', 'OCR_API_KEY_2', 'OCR_API_KEY_3']
const OCR_ENDPOINT = 'https://api.ocr.space/parse/image'
export const OCR_SPACE_FREE_MAX_BYTES = 1024 * 1024
export const OCR_SPACE_FREE_MAX_PAGES = 3
export const OCR_SPACE_DAILY_LIMIT = 500

export interface OcrSpaceUsageLedger {
  reserve(day: string, fingerprint: string, limit: number): Promise<boolean>
  recordSuccess(day: string, fingerprint: string): Promise<void>
  block(day: string, fingerprint: string): Promise<void>
}

export interface OcrSpaceResult {
  success: boolean
  text: string
  provider?: 'ocr.space'
  keySlot?: string
  attempts: number
  error?: string
}

export interface OcrSpaceOptions {
  pageCount?: number
  timeoutMs?: number
  environment?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  ledger?: OcrSpaceUsageLedger
  now?: Date
}

let schemaPromise: Promise<boolean> | undefined

async function ensureLedger(): Promise<boolean> {
  if (!hasDatabase()) return false
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = [
        'CREATE TABLE IF NOT EXISTS ultra_search_ocr_key_usage (',
        'day_utc DATE NOT NULL, key_fingerprint TEXT NOT NULL,',
        'requests INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0,',
        'quota_blocked BOOLEAN NOT NULL DEFAULT FALSE,',
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
        'PRIMARY KEY (day_utc, key_fingerprint))',
      ].join(' ')
      return (await query(sql)) !== null
    })()
  }
  const ready = await schemaPromise
  if (!ready) schemaPromise = undefined
  return ready
}

/** UTC calendar days are conservative local buckets; the provider remains authoritative. */
export const databaseOcrSpaceUsageLedger: OcrSpaceUsageLedger = {
  async reserve(day, fingerprint, limit) {
    if (!await ensureLedger()) return false
    const sql = [
      'INSERT INTO ultra_search_ocr_key_usage (day_utc, key_fingerprint, requests)',
      'VALUES ($1::date, $2, 1)',
      'ON CONFLICT (day_utc, key_fingerprint)',
      'DO UPDATE SET requests = ultra_search_ocr_key_usage.requests + 1, updated_at = NOW()',
      'WHERE ultra_search_ocr_key_usage.requests < $3',
      'AND ultra_search_ocr_key_usage.quota_blocked = FALSE',
      'RETURNING requests',
    ].join(' ')
    const result = await query(sql, [day, fingerprint, limit])
    return Boolean(result?.rows?.length)
  },
  async recordSuccess(day, fingerprint) {
    await query(
      'UPDATE ultra_search_ocr_key_usage SET successes = successes + 1, updated_at = NOW() WHERE day_utc = $1::date AND key_fingerprint = $2',
      [day, fingerprint]
    )
  },
  async block(day, fingerprint) {
    await query(
      'UPDATE ultra_search_ocr_key_usage SET quota_blocked = TRUE, updated_at = NOW() WHERE day_utc = $1::date AND key_fingerprint = $2',
      [day, fingerprint]
    )
  },
}

export function ocrSpaceCapabilities(environment: NodeJS.ProcessEnv = process.env) {
  const keyCount = providerKeyCount(OCR_KEYS, environment)
  return {
    configured: keyCount > 0,
    enabled: environment.ENABLE_OCR_SPACE === 'true' && keyCount > 0,
    keyCount,
    dailyLimitPerKey: OCR_SPACE_DAILY_LIMIT,
    dailyReset: 'UTC',
    ledger: 'Neon PostgreSQL',
    maxFreePdfBytes: OCR_SPACE_FREE_MAX_BYTES,
    maxFreePdfPages: OCR_SPACE_FREE_MAX_PAGES,
  }
}

function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(errorText).join('; ')
  return ''
}

function isQuotaOrAuthError(message: string, status: number): boolean {
  return [401, 402, 403, 429].includes(status)
    || /(?:daily|monthly|hourly|request|conversion|rate).{0,50}(?:limit|exceed|quota)|(?:limit|quota).{0,50}(?:exceed|reach)|too many requests|payment required|invalid api.?key/i.test(message)
}

/**
 * Submit document bytes, never document URLs, to the OCR service.
 * Only the public procurement validator supplies inputs to this function.
 */
export async function recognizePublicSolicitationPdf(
  buffer: Buffer,
  options: OcrSpaceOptions = {}
): Promise<OcrSpaceResult> {
  const environment = options.environment ?? process.env
  if (!ocrSpaceCapabilities(environment).enabled) {
    return { success: false, text: '', attempts: 0, error: 'OCR.space disabled or unconfigured' }
  }
  const pages = options.pageCount ?? 0
  if (pages < 1 || pages > OCR_SPACE_FREE_MAX_PAGES) {
    return { success: false, text: '', attempts: 0, error: 'PDF exceeds three-page free limit' }
  }
  if (!buffer.length || buffer.length > OCR_SPACE_FREE_MAX_BYTES) {
    return { success: false, text: '', attempts: 0, error: 'PDF exceeds 1 MB free limit' }
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return { success: false, text: '', attempts: 0, error: 'Input is not a PDF' }
  }

  const keys = rotatingProviderKeys('ocr-space', OCR_KEYS, OCR_KEYS.length, environment)
  const ledger = options.ledger ?? databaseOcrSpaceUsageLedger
  const fetchImpl = options.fetchImpl ?? fetch
  const day = (options.now ?? new Date()).toISOString().slice(0, 10)
  const deadline = Date.now() + Math.max(1_000, Math.min(options.timeoutMs ?? 8_000, 15_000))
  let attempts = 0
  let lastError = 'All OCR.space keys are at quota or unavailable'

  for (const slot of keys) {
    const remaining = deadline - Date.now()
    if (remaining < 800) break
    const fingerprint = keyFingerprint(slot.value)
    let reserved = false
    try {
      reserved = await ledger.reserve(day, fingerprint, OCR_SPACE_DAILY_LIMIT)
    } catch {
      return { success: false, text: '', attempts, error: 'OCR.space usage ledger unavailable' }
    }
    if (!reserved) continue
    attempts += 1
    try {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), 'solicitation.pdf')
      form.append('language', 'eng')
      form.append('OCREngine', '2')
      form.append('isOverlayRequired', 'false')
      const response = await fetchImpl(OCR_ENDPOINT, {
        method: 'POST',
        headers: { apikey: slot.value, Accept: 'application/json' },
        body: form,
        signal: AbortSignal.timeout(Math.max(1, Math.min(deadline - Date.now(), 5_000))),
        cache: 'no-store',
      })
      if (!response.ok) {
        lastError = 'OCR.space HTTP ' + response.status
        if (isQuotaOrAuthError('', response.status)) await ledger.block(day, fingerprint)
        continue
      }
      const payload = await response.json() as {
        IsErroredOnProcessing?: boolean
        OCRExitCode?: number
        ErrorMessage?: unknown
        ErrorDetails?: unknown
        ParsedResults?: Array<{ ParsedText?: string; FileParseExitCode?: number }>
      }
      const providerError = [errorText(payload.ErrorMessage), errorText(payload.ErrorDetails)].filter(Boolean).join('; ')
      if (payload.IsErroredOnProcessing || (payload.OCRExitCode !== undefined && payload.OCRExitCode !== 1)) {
        lastError = 'OCR.space processing error'
        if (isQuotaOrAuthError(providerError, response.status)) await ledger.block(day, fingerprint)
        continue
      }
      const text = (payload.ParsedResults || [])
        .filter(page => page.FileParseExitCode === undefined || page.FileParseExitCode === 1)
        .map(page => page.ParsedText || '')
        .join('\n')
        .replace(/\s+/g, ' ')
        .trim()
      if (text.length < 10) {
        lastError = 'OCR.space returned insufficient text'
        continue
      }
      await ledger.recordSuccess(day, fingerprint)
      return { success: true, text, provider: 'ocr.space', keySlot: slot.envName, attempts }
    } catch {
      lastError = 'OCR.space request failed or timed out'
    }
  }

  return { success: false, text: '', attempts, error: lastError }
}
