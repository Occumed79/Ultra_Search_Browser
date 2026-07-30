import { OCCUMED_CAPABILITY_GROUPS } from './occumed-rfp-profile'
import type { SemanticIntentPlan } from './semantic-intent'

const PROCUREMENT_WORDS = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity)\b/gi

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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

function occuMedDiscoverySubjects(): string[] {
  return OCCUMED_CAPABILITY_GROUPS.flatMap(group => [
    group.label,
    ...group.terms.slice(0, 2),
  ]).map(normalizeSpace)
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
  const profileAliases = occuMedDiscoverySubjects()
    .filter(value => !subject.toLowerCase().includes(value.toLowerCase()))
    .slice(0, 6)

  return Array.from(new Set([
    `${quotedSubject} (RFP OR RFQ OR solicitation OR bid OR tender) ${currentYear}`,
    `intitle:RFP ${quotedSubject}`,
    `site:.gov ${quotedSubject} (RFP OR RFQ OR solicitation OR "sources sought")`,
    `filetype:pdf ${quotedSubject} ("request for proposals" OR RFP OR RFQ OR IFB)`,
    ...aliases.map(alias => `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation)`),
    ...profileAliases.map(alias => `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`),
  ]))
}
