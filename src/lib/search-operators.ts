export type OperatorsResult = {
  cleanQuery: string
  includedSites: string[]
  excludedSites: string[]
  fileTypes: string[]
  inUrlTerms: string[]
  inTitleTerms: string[]
  exactPhrases: string[]
  requiredTerms: string[]
  excludedTerms: string[]
  booleanMode?: 'AND' | 'OR' | null
}

function normalizeDomain(raw: string): string {
  if (!raw) return raw
  try {
    // If it's a full URL, extract hostname
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw)
      return u.hostname.replace(/^www\./i, '')
    }
  } catch (e) {
    // fallthrough
  }
  // strip common prefixes
  return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\/:\?\#]/)[0]
}

/**
 * Parse simple search operators out of a query string.
 * Deterministic, pure, and safe — does not evaluate or execute anything.
 */
export function parseSearchOperators(rawQuery: string): OperatorsResult {
  let q = (rawQuery || '').trim()
  const includedSites: string[] = []
  const excludedSites: string[] = []
  const fileTypes: string[] = []
  const inUrlTerms: string[] = []
  const inTitleTerms: string[] = []
  const exactPhrases: string[] = []
  const requiredTerms: string[] = []
  const excludedTerms: string[] = []
  let booleanMode: 'AND' | 'OR' | null = null

  // 1) Extract quoted exact phrases
  const quoteRegex = /"([^"]+)"/g
  q = q.replace(quoteRegex, (m, p1) => {
    exactPhrases.push(p1.trim())
    return ' '
  })

  // Helper to remove matched tokens from query
  function removeToken(matched: string) {
    q = q.replace(matched, ' ')
  }

  // 2) site: and -site:
  const siteRegex = /(^|\s)(-)?site:([^\s]+)/gi
  q = q.replace(siteRegex, (m, p1, minus, host) => {
    const norm = normalizeDomain(host)
    if (minus) excludedSites.push(norm)
    else includedSites.push(norm)
    return ' '
  })

  // 3) filetype:
  const filetypeRegex = /(^|\s)(-)?filetype:([^\s]+)/gi
  q = q.replace(filetypeRegex, (m, p1, minus, ft) => {
    const val = ft.toLowerCase()
    if (minus) {
      excludedTerms.push(`filetype:${val}`)
    } else {
      fileTypes.push(val)
    }
    return ' '
  })

  // 4) inurl: and -inurl:
  const inurlRegex = /(^|\s)(-)?inurl:([^\s]+)/gi
  q = q.replace(inurlRegex, (m, p1, minus, term) => {
    if (minus) excludedTerms.push(term)
    else inUrlTerms.push(term)
    return ' '
  })

  // 5) intitle: and -intitle:
  const intitleRegex = /(^|\s)(-)?intitle:([^\s]+)/gi
  q = q.replace(intitleRegex, (m, p1, minus, term) => {
    if (minus) excludedTerms.push(term)
    else inTitleTerms.push(term)
    return ' '
  })

  // 6) +requiredTerm (simple tokens)
  const plusTermRegex = /(^|\s)\+([^\s]+)/g
  q = q.replace(plusTermRegex, (m, p1, term) => {
    requiredTerms.push(term)
    return ' '
  })

  // 7) -excludedTerm (tokens not part of other operators)
  // We processed -site/-inurl/-intitle already; now catch standalone -word
  const minusTermRegex = /(^|\s)-([^\s]+)/g
  q = q.replace(minusTermRegex, (m, p1, term) => {
    // ignore if it looks like an operator we already processed
    const lowered = term.toLowerCase()
    if (lowered.startsWith('site:') || lowered.startsWith('inurl:') || lowered.startsWith('intitle:') || lowered.startsWith('filetype:')) {
      return ' '
    }
    excludedTerms.push(term)
    return ' '
  })

  // 8) Boolean AND / OR (standalone tokens)
  // If both present, prefer the first encountered
  const andRegex = /\bAND\b/i
  const orRegex = /\bOR\b/i
  if (andRegex.test(q)) {
    booleanMode = 'AND'
    q = q.replace(/\bAND\b/gi, ' ')
  } else if (orRegex.test(q)) {
    booleanMode = 'OR'
    q = q.replace(/\bOR\b/gi, ' ')
  }

  // After removing operators, collect remaining terms as required (if any)
  // Split by whitespace and filter empties
  const remaining = q
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)

  // Treat remaining tokens as requiredTerms unless they are common stopwords like +/ - already handled
  for (const t of remaining) {
    // ignore pure operators
    if (/^[+\-!]/.test(t)) continue
    requiredTerms.push(t)
  }

  // Build cleanQuery from requiredTerms (excluding terms we captured as excluded)
  const cleanQuery = requiredTerms.join(' ').trim()

  return {
    cleanQuery,
    includedSites,
    excludedSites,
    fileTypes,
    inUrlTerms,
    inTitleTerms,
    exactPhrases,
    requiredTerms,
    excludedTerms,
    booleanMode,
  }
}

// Lightweight examples in comments
// Example:
// parseSearchOperators('site:example.com "fee schedule" +price -oldfile filetype:pdf')
// -> { cleanQuery: 'price oldfile', includedSites: ['example.com'], exactPhrases: ['fee schedule'], fileTypes: ['pdf'], ... }
