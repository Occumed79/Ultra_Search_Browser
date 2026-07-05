import type { SearchVerticalId } from './verticals'

export type BangsResult = {
  cleanQuery: string
  forcedVertical?: SearchVerticalId
  recency?: 'day' | 'week' | 'month' | 'year'
  flags: string[]
}

const BANG_MAP: Record<string, Partial<{ vertical: SearchVerticalId; recency: BangsResult['recency'] }>> = {
  price: { vertical: 'pricing' },
  pricing: { vertical: 'pricing' },
  rfp: { vertical: 'procurement' },
  bid: { vertical: 'procurement' },
  gov: { vertical: 'government' },
  pdf: { vertical: 'pdf' },
  provider: { vertical: 'provider' },
  email: { vertical: 'contacts' },
  contact: { vertical: 'contacts' },
  contacts: { vertical: 'contacts' },
  week: { recency: 'week' },
  month: { recency: 'month' },
  year: { recency: 'year' },
  day: { recency: 'day' },
}

export function parseBangs(rawQuery: string): BangsResult {
  let q = (rawQuery || '').trim()
  const flags: string[] = []
  let forcedVertical: SearchVerticalId | undefined
  let recency: BangsResult['recency'] | undefined

  // Find bangs like !price, accept at start, middle, or end
  const bangRegex = /(^|\s)!(\w+)/g
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = bangRegex.exec(q)) !== null) {
    found.push(m[2].toLowerCase())
  }

  for (const b of found) {
    const mapped = BANG_MAP[b]
    if (mapped) {
      if (mapped.vertical) forcedVertical = mapped.vertical
      if (mapped.recency) recency = mapped.recency
      flags.push(b)
    } else {
      // Unknown bangs are kept in flags but otherwise ignored
      flags.push(b)
    }
  }

  // Remove bangs from query text
  q = q.replace(bangRegex, ' ')
  q = q.replace(/\s+/g, ' ').trim()

  return {
    cleanQuery: q,
    forcedVertical,
    recency,
    flags,
  }
}

// Examples (comments):
// parseBangs('!price dot physical fresno') -> { cleanQuery: 'dot physical fresno', forcedVertical: 'pricing', flags: ['price'] }
// parseBangs('dot physical fresno !price') -> same result
