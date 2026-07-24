import type { SearchLens } from '../types/search'

export type ResultLifecycleStatus =
  | 'active'
  | 'current'
  | 'open'
  | 'expired'
  | 'closed'
  | 'cancelled'
  | 'awarded'
  | 'stale'
  | 'unknown'
  | 'dead'
  | 'junk'
  | 'duplicate'

export interface ExtractedStatusDate {
  kind: 'posted' | 'modified' | 'due' | 'closing' | 'expiration' | 'award' | 'unknown'
  value: string
  iso?: string
  context: string
}

export interface ResultStatusAssessment {
  status: ResultLifecycleStatus
  reason: string
  confidence: number
  dates: ExtractedStatusDate[]
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

const DATE_PATTERN = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4})\b/gi

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function parseStatusDate(value: string): Date | undefined {
  const text = value.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 23, 59, 59))
    return Number.isNaN(date.getTime()) ? undefined : date
  }

  const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (numeric) {
    const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3])
    const date = new Date(Date.UTC(year, Number(numeric[1]) - 1, Number(numeric[2]), 23, 59, 59))
    return Number.isNaN(date.getTime()) ? undefined : date
  }

  const named = text.match(/^([a-z]+)\s+(\d{1,2})[,]?\s+(\d{4})$/i)
  if (named) {
    const month = MONTHS[named[1].toLowerCase()]
    if (month === undefined) return undefined
    const date = new Date(Date.UTC(Number(named[3]), month, Number(named[2]), 23, 59, 59))
    return Number.isNaN(date.getTime()) ? undefined : date
  }

  return undefined
}

function classifyDateKind(context: string): ExtractedStatusDate['kind'] {
  const value = context.toLowerCase()
  if (/\b(?:response|proposal|bid|submission)s?\s+(?:are\s+)?due\b|\bdue\s+date\b|\bdeadline\b/.test(value)) return 'due'
  if (/\bclos(?:e|es|ed|ing)\b|\bclosing\s+date\b/.test(value)) return 'closing'
  if (/\bexpir(?:e|es|ed|ation)\b|\bvalid\s+through\b/.test(value)) return 'expiration'
  if (/\baward(?:ed|\s+date)?\b/.test(value)) return 'award'
  if (/\bmodified\b|\blast\s+updated\b|\bupdated\b/.test(value)) return 'modified'
  if (/\bposted\b|\bpublished\b|\breleased\b|\bissued\b/.test(value)) return 'posted'
  return 'unknown'
}

export function extractStatusDates(text: string): ExtractedStatusDate[] {
  const normalized = clean(text).slice(0, 200_000)
  const dates: ExtractedStatusDate[] = []
  const seen = new Set<string>()

  for (const match of normalized.matchAll(DATE_PATTERN)) {
    const value = match[0]
    const index = match.index ?? 0
    const context = normalized.slice(Math.max(0, index - 90), Math.min(normalized.length, index + value.length + 90))
    const kind = classifyDateKind(context)
    const parsed = parseStatusDate(value)
    const key = `${kind}:${parsed?.toISOString().slice(0, 10) || value.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    dates.push({
      kind,
      value,
      iso: parsed?.toISOString(),
      context: clean(context).slice(0, 260),
    })
    if (dates.length >= 16) break
  }

  return dates
}

function latestDate(dates: ExtractedStatusDate[], kinds: ExtractedStatusDate['kind'][]): Date | undefined {
  return dates
    .filter(item => kinds.includes(item.kind) && item.iso)
    .map(item => new Date(item.iso as string))
    .sort((left, right) => right.getTime() - left.getTime())[0]
}

function earliestDate(dates: ExtractedStatusDate[], kinds: ExtractedStatusDate['kind'][]): Date | undefined {
  return dates
    .filter(item => kinds.includes(item.kind) && item.iso)
    .map(item => new Date(item.iso as string))
    .sort((left, right) => left.getTime() - right.getTime())[0]
}

export function classifyResultStatus(
  text: string,
  lens: SearchLens,
  now = new Date()
): ResultStatusAssessment {
  const normalized = clean(text).toLowerCase()
  const dates = extractStatusDates(text)

  if (/\b(?:solicitation|opportunity|procurement|bid|rfp|rfq)\s+(?:has\s+been\s+)?cancelled\b|\bcancelled\s+(?:solicitation|opportunity|procurement|bid|rfp|rfq)\b/.test(normalized)) {
    return { status: 'cancelled', reason: 'The page explicitly says the opportunity was cancelled.', confidence: 0.98, dates }
  }
  if (/\b(?:contract|bid|solicitation|opportunity)\s+(?:has\s+been\s+)?awarded\b|\bnotice\s+of\s+award\b|\bawardee\b/.test(normalized)) {
    return { status: 'awarded', reason: 'The page identifies the item as awarded.', confidence: 0.96, dates }
  }
  if (/\b(?:submissions?|responses?|bidding)\s+(?:are\s+)?closed\b|\bclosed\s+(?:solicitation|opportunity|bid)\b|\bno\s+longer\s+accepting\b/.test(normalized)) {
    return { status: 'closed', reason: 'The page explicitly says submissions or bidding are closed.', confidence: 0.97, dates }
  }
  if (/\barchived\s+(?:solicitation|opportunity|notice)\b|\bthis\s+(?:notice|opportunity)\s+has\s+expired\b/.test(normalized)) {
    return { status: 'expired', reason: 'The page explicitly identifies the item as archived or expired.', confidence: 0.97, dates }
  }

  const deadline = earliestDate(dates, ['due', 'closing', 'expiration'])
  if (deadline && deadline.getTime() < now.getTime()) {
    return {
      status: 'expired',
      reason: `The extracted deadline ${deadline.toISOString().slice(0, 10)} has passed.`,
      confidence: lens === 'procurement' ? 0.96 : 0.86,
      dates,
    }
  }

  if (/\bcurrently\s+open\b|\baccepting\s+(?:bids|proposals|responses|applications)\b|\bopen\s+solicitation\b|\bactive\s+solicitation\b/.test(normalized)) {
    return { status: 'open', reason: 'The page explicitly says the item is open or accepting responses.', confidence: 0.94, dates }
  }

  if (deadline && deadline.getTime() >= now.getTime()) {
    return {
      status: lens === 'procurement' ? 'open' : 'active',
      reason: `The extracted deadline ${deadline.toISOString().slice(0, 10)} is still in the future.`,
      confidence: 0.92,
      dates,
    }
  }

  if (lens === 'news') {
    const published = latestDate(dates, ['posted', 'modified', 'unknown'])
    if (published && now.getTime() - published.getTime() > 1000 * 60 * 60 * 24 * 540) {
      return { status: 'stale', reason: 'The newest visible publication date is more than 18 months old.', confidence: 0.78, dates }
    }
  }

  if (lens === 'procurement') {
    return { status: 'unknown', reason: 'No conclusive open, closed, awarded, cancelled, or deadline evidence was found.', confidence: 0.45, dates }
  }

  if (lens === 'provider' || lens === 'pricing' || lens === 'medical' || lens === 'legal' || lens === 'academic' || lens === 'financial') {
    return { status: 'current', reason: 'The page is reachable and contains no conclusive stale or closed status signal.', confidence: 0.66, dates }
  }

  return { status: 'current', reason: 'The page is reachable and no expiration signal applies to this lens.', confidence: 0.62, dates }
}
