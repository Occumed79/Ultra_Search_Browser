import type { SemanticIntentPlan } from './semantic-intent'

const PROCUREMENT_WORDS = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity)\b/gi

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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
  const aliases = semanticSubjects(intent)
    .filter(value => value.toLowerCase() !== subject.toLowerCase())
    .slice(0, 8)
  return Array.from(new Set([
    `${subject} RFP solicitation bid`,
    ...aliases.map(alias => `${alias} RFP solicitation`),
    `site:.gov ${subject} RFP`,
    `filetype:pdf ${subject} request for proposals`,
  ]))
}
