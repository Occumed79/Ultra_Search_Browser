import type { SemanticIntentPlan } from './semantic-intent'

const PROCUREMENT_WORDS = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity)\b/gi
const PROCUREMENT_WORD_TEST = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity)\b/i

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function quotedPhrase(value: string): string {
  return `"${normalizeSpace(value).replace(/"/g, '')}"`
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.map(normalizeSpace).filter(value => {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
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
  return unique(subjects.flatMap(group => [
    group.label,
    ...group.terms.slice(0, 10),
  ]))
}

export function buildProcurementTitleQueries(
  query: string,
  intent?: SemanticIntentPlan
): string[] {
  const subject = procurementSubject(query)
  const withoutServices = normalizeSpace(subject.replace(/\bservices?\b/gi, ' '))
  const aliases = semanticSubjects(intent)
    .filter(value => !PROCUREMENT_WORD_TEST.test(value))
    .filter(value => value.split(/\s+/).length >= 2)

  return unique([
    subject,
    withoutServices,
    ...aliases,
  ]).slice(0, 8)
}

export function buildProcurementRescueQueries(
  query: string,
  intent?: SemanticIntentPlan
): string[] {
  const subject = procurementSubject(query)
  const quotedSubject = quotedPhrase(subject)
  const currentYear = new Date().getUTCFullYear()
  const aliases = semanticSubjects(intent)
    .filter(value => value.toLowerCase() !== subject.toLowerCase())
    .slice(0, 8)

  return Array.from(new Set([
    `${quotedSubject} (RFP OR RFQ OR solicitation OR bid) ${currentYear}`,
    `intitle:RFP ${quotedSubject}`,
    `site:.gov ${quotedSubject} (RFP OR RFQ OR solicitation)`,
    `filetype:pdf ${quotedSubject} ("request for proposals" OR RFP OR RFQ)`,
    ...aliases.map(alias => `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation)`),
  ]))
}
