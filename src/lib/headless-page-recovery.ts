import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { extractFromHTML, type ExtractedDocument } from './document-extraction'

const execFileAsync = promisify(execFile)
const MAX_RENDERED_HTML_BYTES = 6 * 1024 * 1024
const MAX_HEADLESS_TIMEOUT_MS = 8_000
const MAX_HEADLESS_PER_MINUTE = 8
let activeHeadless = 0
let windowStartedAt = Date.now()
let windowCalls = 0

export interface HeadlessRecoveryResult {
  success: boolean
  document?: ExtractedDocument
  error?: string
  runtimeMs: number
}

function configuredExecutable(): string | undefined {
  if (process.env.ENABLE_HEADLESS_VALIDATION !== 'true') return undefined
  const executable = process.env.CHROMIUM_EXECUTABLE_PATH?.trim()
  return executable || undefined
}

export function headlessRecoveryCapabilities() {
  return {
    enabled: process.env.ENABLE_HEADLESS_VALIDATION === 'true',
    configured: Boolean(configuredExecutable()),
    maxConcurrency: 1,
    maxPerMinute: MAX_HEADLESS_PER_MINUTE,
    timeoutMs: MAX_HEADLESS_TIMEOUT_MS,
  }
}

function consumeBudget(): boolean {
  const now = Date.now()
  if (now - windowStartedAt >= 60_000) {
    windowStartedAt = now
    windowCalls = 0
  }
  if (windowCalls >= MAX_HEADLESS_PER_MINUTE) return false
  windowCalls += 1
  return true
}

function safePublicHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
    if (parsed.username || parsed.password) return undefined
    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      || /^169\.254\./.test(host)
      || host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
    ) return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

export async function recoverClientRenderedDocument(url: string, timeoutMs = 6_500): Promise<HeadlessRecoveryResult> {
  const startedAt = Date.now()
  const executable = configuredExecutable()
  if (!executable) return { success: false, error: 'Headless validation is not configured.', runtimeMs: Date.now() - startedAt }
  const safeUrl = safePublicHttpUrl(url)
  if (!safeUrl) return { success: false, error: 'Headless recovery rejected an unsafe URL.', runtimeMs: Date.now() - startedAt }
  if (activeHeadless >= 1) return { success: false, error: 'Headless recovery concurrency budget is busy.', runtimeMs: Date.now() - startedAt }
  if (!consumeBudget()) return { success: false, error: 'Headless recovery per-minute budget is exhausted.', runtimeMs: Date.now() - startedAt }

  activeHeadless += 1
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ultra-search-chromium-'))
  try {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      `--user-data-dir=${userDataDir}`,
      '--virtual-time-budget=3000',
      '--dump-dom',
      safeUrl,
    ]
    if (process.env.CHROMIUM_NO_SANDBOX === 'true') args.unshift('--no-sandbox')

    const { stdout } = await execFileAsync(executable, args, {
      timeout: Math.max(2_000, Math.min(timeoutMs, MAX_HEADLESS_TIMEOUT_MS)),
      maxBuffer: MAX_RENDERED_HTML_BYTES,
      windowsHide: true,
    })
    if (!stdout || Buffer.byteLength(stdout, 'utf8') < 180) {
      return { success: false, error: 'Headless browser returned too little rendered HTML.', runtimeMs: Date.now() - startedAt }
    }
    const document = extractFromHTML(stdout, safeUrl)
    if (document.text.length < 180) {
      return { success: false, error: 'Headless browser rendered the page but still exposed too little readable text.', runtimeMs: Date.now() - startedAt }
    }
    return { success: true, document, runtimeMs: Date.now() - startedAt }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? `Headless recovery failed: ${error.message}` : 'Headless recovery failed.',
      runtimeMs: Date.now() - startedAt,
    }
  } finally {
    activeHeadless = Math.max(0, activeHeadless - 1)
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
