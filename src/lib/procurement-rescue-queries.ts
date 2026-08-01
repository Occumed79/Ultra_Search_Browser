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
  return normalizeSpace(
    query
      .replace(PROCUREMENT_WORDS, ' ')
      .replace(/\b(?:open|current|active|opportunity|opportunities)\b/gi, ' ')
  ) || normalizeSpace(query)
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
    : quotedSubject

  const individualAliasQueries = discoveryTerms.map(alias =>
    `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`
  )

  // The browser rescue executes only four Bing variants. Use those slots for
  // genuinely different discovery strategies: the literal phrase, the related
  // buyer-language family, government pages using that family, and direct PDF
  // solicitations. This avoids wasting the budget on punctuation variants of
  // the same phrase.
  return Array.from(new Set([
    `${quotedSubject} (RFP OR RFQ OR solicitation OR bid OR tender) ${currentYear}`,
    `${familyClause} (RFP OR RFQ OR solicitation OR bid OR tender OR "sources sought") ${currentYear}`,
    `site:.gov ${familyClause} (RFP OR RFQ OR solicitation OR "sources sought")`,
    `filetype:pdf ${familyClause} ("request for proposals" OR RFP OR RFQ OR IFB OR solicitation)`,
    `intitle:RFP ${quotedSubject}`,
    ...individualAliasQueries,
  ]))
}
