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
      .replace(/^pre-employment/, 'pre employment')
      .replace(/^pre-/, 'pre ')
  )
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
  const bestAlias = discoveryTerms[0] ? quotedPhrase(discoveryTerms[0]) : ''
  // Official buyers frequently use either the user's phrase OR a buyer-language
  // synonym, not both. Requiring both made otherwise excellent .gov/PDF hits
  // invisible. Keep them as alternatives while the later evidence gate restores
  // precision from the actual destination/package.
  const subjectFamily = bestAlias
    ? `(${quotedSubject} OR ${bestAlias})`
    : quotedSubject

  const individualAliasQueries = buyerAliases.map(alias =>
    `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`
  )

  const militaryKeywords = ['deployment', 'military', 'defense', 'dod', 'overseas', 'clearance', 'readiness']
  const isMilitaryQuery = militaryKeywords.some(keyword => query.toLowerCase().includes(keyword))
  const militaryQueries = isMilitaryQuery ? [
    `site:acquisition.gov ${subjectFamily} procurement`,
    `site:defense.gov ${subjectFamily} procurement`,
    `site:dla.mil ${subjectFamily} procurement`,
    `${subjectFamily} "defense logistics agency" solicitation`,
    `${subjectFamily} "department of defense" solicitation`,
    `${subjectFamily} "military medical" contract`,
  ] : []

  const diversifiedFront = [
    `${quotedSubject} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`,
    familyClause
      ? `${familyClause} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`
      : `${quotedSubject} "contract opportunities" ${currentYear}`,
    `site:.gov ${subjectFamily} (RFP OR solicitation OR "sources sought") ${currentYear}`,
    `filetype:pdf ${subjectFamily} ("request for proposal" OR solicitation) ${currentYear}`,
  ]

  const officialAndPortalQueries = [
    `site:sam.gov ${subjectFamily} opportunities`,
    `site:sam.gov ${subjectFamily} solicitation`,
    `site:.gov ${quotedSubject} "contract opportunities"`,
    `site:.gov ${quotedSubject} "vendor opportunities"`,
    `site:.gov ${quotedSubject} "bid opportunities"`,
    `site:bidnetdirect.com ${quotedSubject} "contract opportunities"`,
    `site:rfpmart.com ${quotedSubject} RFP`,
    `site:findrfp.com ${quotedSubject} solicitation`,
    `site:govwin.com ${quotedSubject} "government contract"`,
  ]

  const naturalLanguageQueries = [
    `${quotedSubject} "contract opportunities" ${currentYear}`,
    `${quotedSubject} "vendor opportunities" ${currentYear}`,
    `${quotedSubject} "sources sought" ${currentYear}`,
    `${quotedSubject} "bid opportunities" ${currentYear}`,
    `${quotedSubject} "healthcare procurement" ${currentYear}`,
    `${quotedSubject} "medical services contract" ${currentYear}`,
  ]

  return Array.from(new Set([
    ...diversifiedFront,
    ...individualAliasQueries,
    ...officialAndPortalQueries,
    ...naturalLanguageQueries,
    ...militaryQueries,
  ]))
}
