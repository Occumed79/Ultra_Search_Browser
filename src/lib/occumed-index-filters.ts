/**
 * Occu-Med relevance filters for structured index feeds (SAM.gov, Federal Register).
 * Keeps the local Neon index aligned with occupational health / exam services scope.
 * Not a crawler — used only to filter API feed results.
 */

/** NAICS codes commonly tied to Occu-Med-style work */
export const OCCUMED_NAICS = [
  '621111', // Offices of physicians
  '621340', // Offices of physical, occupational and speech therapists
  '621399', // Offices of all other miscellaneous health practitioners
  '621999', // All other miscellaneous ambulatory health care
  '621610', // Home health care (sometimes used for mobile/on-site medical)
  '541612', // Human resources consulting (sometimes used for testing programs)
  '561612', // Security systems / related (occasionally used for screening contracts)
] as const

/** Title/query phrases for SAM title= parameter (one per request) */
export const OCCUMED_SAM_TITLE_QUERIES = [
  'occupational health',
  'occupational medicine',
  'medical surveillance',
  'drug testing',
  'drug and alcohol',
  'pre-employment physical',
  'pre employment physical',
  'fitness for duty',
  'fitness-for-duty',
  'employee health',
  'workforce health',
  'respirator fit',
  'audiometric',
  'spirometry',
  'deployment health',
  'physical examination',
] as const

/** Phrases that must appear (title or description) for a result to be kept */
export const OCCUMED_POSITIVE_PATTERNS: RegExp[] = [
  /occupational\s+health/i,
  /occupational\s+medicine/i,
  /occ\s*-?\s*health/i,
  /employee\s+health/i,
  /workforce\s+health/i,
  /medical\s+surveillance/i,
  /industrial\s+medicine/i,
  /pre[-\s]?employment\s+(physical|exam|screening|medical)/i,
  /fitness[-\s]?for[-\s]?duty/i,
  /drug\s+(and\s+alcohol\s+)?(test|screen|testing)/i,
  /alcohol\s+(test|screen|testing)/i,
  /substance\s+abuse\s+(test|screen|testing)/i,
  /respirator\s+(fit|medical|clearance|evaluation)/i,
  /audiometr/i,
  /spirometr/i,
  /\bpft\b/i,
  /pulmonary\s+function/i,
  /deployment\s+health/i,
  /post[-\s]?deployment\s+health/i,
  /physical\s+examination/i,
  /medical\s+examination/i,
  /clinic\s+network/i,
  /provider\s+network.*(health|medical|exam)/i,
  /mobile\s+medical/i,
  /on[-\s]?site\s+medical/i,
  /DOT\s+(physical|exam|medical)/i,
  /commercial\s+driver.*(exam|physical|medical)/i,
]

/** Hard excludes — construction/IT/etc. noise that sometimes matches loosely */
export const OCCUMED_NEGATIVE_PATTERNS: RegExp[] = [
  /software\s+development/i,
  /IT\s+support/i,
  /information\s+technology\s+services/i,
  /janitorial/i,
  /custodial/i,
  /lawn\s+care/i,
  /paving/i,
  /asphalt/i,
  /roofing/i,
]

export function textMatchesOccuMed(text: string): boolean {
  const t = text || ''
  if (OCCUMED_NEGATIVE_PATTERNS.some(re => re.test(t))) return false
  return OCCUMED_POSITIVE_PATTERNS.some(re => re.test(t))
}

export function naicsMatchesOccuMed(naics: string | null | undefined): boolean {
  if (!naics) return false
  const code = String(naics).replace(/\D/g, '').slice(0, 6)
  if (!code) return false
  return OCCUMED_NAICS.some(n => code.startsWith(n) || n.startsWith(code))
}

/**
 * Keep if NAICS matches OR title/description matches Occu-Med language.
 */
export function isOccuMedRelevant(params: {
  title?: string
  description?: string
  naics?: string | null
}): boolean {
  if (naicsMatchesOccuMed(params.naics)) {
    // Still drop pure IT/janitorial even if NAICS is odd
    const blob = `${params.title || ''} ${params.description || ''}`
    if (OCCUMED_NEGATIVE_PATTERNS.some(re => re.test(blob))) return false
    return true
  }
  return textMatchesOccuMed(`${params.title || ''} ${params.description || ''}`)
}
