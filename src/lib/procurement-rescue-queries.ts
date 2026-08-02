import { buyerLanguageTermsForQuery } from './occumed-capability-matching'
import type { SemanticIntentPlan } from './semantic-intent'

const PROCUREMENT_WORDS = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity)\b/gi

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalize(value: string): string {
  return normalizeSpace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function quotedPhrase(value: string): string {
  return `"${normalizeSpace(value).replace(/"/g, '')}"`
}

export function procurementSubject(query: string): string {
  const cleaned = normalizeSpace(
    query
      .replace(PROCUREMENT_WORDS, ' ')
      .replace(/\b(?:open|current|active|opportunity|opportunities)\b/gi, ' ')
      .replace(/\bsite:\S+/gi, ' ')
      .replace(/\bfiletype:\S+/gi, ' ')
      .replace(/\bintitle:\S+/gi, ' ')
      .replace(/\binurl:\S+/gi, ' ')
      .replace(/^pre-employment/, 'pre employment') // Fix "pre-employment" to "pre employment"
      .replace(/^pre-/, 'pre ') // Handle other "pre-" prefixes
  )
  // Return the cleaned subject, or if too short, use a fallback
  if (cleaned.length < 5) {
    return 'occupational health services'
  }
  return cleaned
}

function semanticSubjects(intent?: SemanticIntentPlan): string[] {
  if (!intent) return []
  const subjects = intent.conceptGroups
    .filter(group => group.required && group.kind !== 'format' && group.kind !== 'time')
  return Array.from(new Set(subjects.flatMap(group => [
    group.label,
    ...group.terms.slice(0, 10),
  ]).map(normalizeSpace).filter(Boolean)))
}

export function buildProcurementRescueQueries(
  query: string,
  intent?: SemanticIntentPlan
): string[] {
  const subject = procurementSubject(query)
  const quotedSubject = quotedPhrase(subject)
  const currentYear = new Date().getUTCFullYear()
  const semanticAliases = semanticSubjects(intent)
    .filter(value => normalize(value) !== normalize(subject))
  const buyerAliases = buyerLanguageTermsForQuery(subject, 10)
  const discoveryTerms = Array.from(new Map(
    [...buyerAliases, ...semanticAliases]
      .filter(Boolean)
      .filter(value => normalize(value) !== normalize(subject))
      .map(value => [normalize(value), value])
  ).values()).slice(0, 8)
  const familyClause = discoveryTerms.length > 0
    ? `(${discoveryTerms.slice(0, 6).map(quotedPhrase).join(' OR ')})`
    : ''

  const individualAliasQueries = buyerAliases.flatMap(alias => [
    `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`,
  ])

  // Military/defense specific queries
  const militaryKeywords = ['deployment', 'military', 'defense', 'dod', 'overseas', 'clearance', 'readiness']
  const isMilitaryQuery = militaryKeywords.some(keyword => query.toLowerCase().includes(keyword))
  
  const militaryQueries = isMilitaryQuery ? [
    `site:dibbs.dla.mil ${quotedSubject}`,
    `site:acquisition.gov ${quotedSubject}`,
    `site:defense.gov ${quotedSubject} procurement`,
    `site:dla.mil ${quotedSubject}`,
    `${quotedSubject} "defense logistics agency"`,
    `${quotedSubject} "department of defense"`,
    `${quotedSubject} "military medical"`,
  ] : []

  // Simplified queries that are more likely to return results
  const simplifiedQueries = [
    `${quotedSubject} RFP -stock -market -trading`,
    `${quotedSubject} "request for proposal" -stock -market`,
    `${quotedSubject} "contract opportunities" -stock -market`,
    `${quotedSubject} "vendor opportunities" -stock -market`,
    `site:.gov ${quotedSubject} RFP -stock -market`,
    `site:.gov ${quotedSubject} "request for proposal" -stock -market`,
    `${quotedSubject} procurement -stock -market`,
    `${quotedSubject} "government contract" -stock -market`,
    `${quotedSubject} solicitation -stock -market`,
    `${quotedSubject} medical -stock -market`,
    `${quotedSubject} healthcare -stock -market`,
  ]

  return Array.from(new Set([
    // Simplified queries first (more likely to return results)
    ...simplifiedQueries,
    // Use more specific procurement terminology
    `${quotedSubject} "contract opportunities" ${currentYear}`,
    `${quotedSubject} "vendor opportunities" ${currentYear}`,
    `${quotedSubject} "sources sought" ${currentYear}`,
    `${quotedSubject} "bid opportunities" ${currentYear}`,
    // Government procurement portals
    `site:sam.gov ${quotedSubject} opportunities`,
    `site:sam.gov ${quotedSubject} solicitation`,
    `site:bidnetdirect.com ${quotedSubject} "contract opportunities"`,
    `site:rfpmart.com ${quotedSubject} RFP`,
    `site:findrfp.com ${quotedSubject} solicitation`,
    `site:govwin.com ${quotedSubject} "government contract"`,
    // State and local government
    `site:.gov ${quotedSubject} "contract opportunities"`,
    `site:.gov ${quotedSubject} "vendor opportunities"`,
    `site:.gov ${quotedSubject} "bid opportunities"`,
    // PDF documents (often contain actual RFPs)
    `filetype:pdf ${quotedSubject} "request for proposal" ${currentYear}`,
    `filetype:pdf ${quotedSubject} solicitation ${currentYear}`,
    // Industry-specific terms
    `${quotedSubject} "healthcare procurement" ${currentYear}`,
    `${quotedSubject} "medical services contract" ${currentYear}`,
    ...individualAliasQueries,
    ...militaryQueries,
  ]))
}
