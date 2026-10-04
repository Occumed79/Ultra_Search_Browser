import {
  canonicalBuyerTerms,
  canonicalSearchBundleTerms,
  canonicalSearchPriorityAgencies,
  canonicalTargetBuyerTypes,
} from './canonical-relevance'
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
  return cleaned.length < 5 ? cleaned || normalizeSpace(query) : cleaned
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
  const buyerAliases = canonicalBuyerTerms(subject, 10)
  const bundleTerms = canonicalSearchBundleTerms(subject, 10)
  const discoveryTerms = Array.from(new Map(
    [...bundleTerms, ...buyerAliases, ...semanticAliases]
      .filter(Boolean)
      .filter(value => normalize(value) !== normalize(subject))
      .map(value => [normalize(value), value])
  ).values()).slice(0, 12)

  const familyClause = discoveryTerms.length > 0
    ? `(${discoveryTerms.slice(0, 6).map(quotedPhrase).join(' OR ')})`
    : ''
  const bestAlias = discoveryTerms[0] ? quotedPhrase(discoveryTerms[0]) : ''
  const subjectFamily = bestAlias
    ? `(${quotedSubject} OR ${bestAlias})`
    : quotedSubject

  const profileTermQueries = discoveryTerms.slice(0, 6).map(term =>
    `${quotedPhrase(term)} (RFP OR RFQ OR solicitation OR tender OR "sources sought") ${currentYear}`
  )

  const buyerTypeQueries = canonicalTargetBuyerTypes(5).map(buyer =>
    `${subjectFamily} ${quotedPhrase(buyer)} (RFP OR solicitation OR bid)`
  )

  const agencyQueries = canonicalSearchPriorityAgencies(5).map(agency =>
    `${subjectFamily} ${quotedPhrase(agency)} (RFP OR solicitation OR "sources sought")`
  )

  // Manual-style sweep: vary source shape, document type, buyer type and lifecycle wording
  // rather than repeatedly sending one synonym query to every provider.
  const diversifiedFront = [
    `${quotedSubject} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`,
    familyClause
      ? `${familyClause} (RFP OR RFQ OR solicitation OR tender OR "sources sought") ${currentYear}`
      : `${quotedSubject} "contract opportunities" ${currentYear}`,
    `site:.gov ${subjectFamily} (RFP OR solicitation OR "sources sought") ${currentYear}`,
    `filetype:pdf ${subjectFamily} ("request for proposal" OR solicitation OR "statement of work") ${currentYear}`,
    `${subjectFamily} ("vendor opportunities" OR "bid opportunities" OR "procurement opportunities") ${currentYear}`,
    `${subjectFamily} ("responses due" OR "submission deadline" OR "closing date") ${currentYear}`,
  ]

  const officialAndPortalQueries = [
    `site:sam.gov ${subjectFamily} opportunities`,
    `site:sam.gov ${subjectFamily} solicitation`,
    `site:.gov ${quotedSubject} "contract opportunities"`,
    `site:.gov ${quotedSubject} "vendor opportunities"`,
    `site:.gov ${quotedSubject} "bid opportunities"`,
    `site:ionwave.net ${quotedSubject}`,
    `site:bonfirehub.com ${quotedSubject}`,
    `site:planetbids.com ${quotedSubject}`,
    `site:bidnetdirect.com ${quotedSubject}`,
    `site:publicpurchase.com ${quotedSubject}`,
    `site:opengov.com ${quotedSubject}`,
  ]

  const naturalLanguageQueries = [
    `${quotedSubject} "contract opportunities" ${currentYear}`,
    `${quotedSubject} "vendor opportunities" ${currentYear}`,
    `${quotedSubject} "sources sought" ${currentYear}`,
    `${quotedSubject} "bid opportunities" ${currentYear}`,
    `${quotedSubject} "request for qualifications" ${currentYear}`,
    `${quotedSubject} "statement of work" ${currentYear}`,
  ]

  return Array.from(new Set([
    ...diversifiedFront,
    ...profileTermQueries,
    ...buyerTypeQueries,
    ...agencyQueries,
    ...officialAndPortalQueries,
    ...naturalLanguageQueries,
  ]))
}
