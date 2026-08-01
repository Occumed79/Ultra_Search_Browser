import { OCCUMED_CAPABILITY_GROUPS } from './occumed-rfp-profile'
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

function occuMedDiscoverySubjects(subject: string): string[] {
  const subjectTokens = new Set(normalize(subject).split(' ').filter(token => token.length >= 3))
  const candidates = OCCUMED_CAPABILITY_GROUPS.flatMap(group => [
    ...group.terms,
    group.label,
  ]).map(normalizeSpace).filter(Boolean)

  const overlapScore = (value: string): number => {
    const tokens = normalize(value).split(' ').filter(token => token.length >= 3)
    return tokens.reduce((score, token) => score + (subjectTokens.has(token) ? 1 : 0), 0)
  }

  return Array.from(new Set(candidates)).sort((left, right) => {
    const scoreDelta = overlapScore(right) - overlapScore(left)
    if (scoreDelta !== 0) return scoreDelta
    return left.length - right.length
  })
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
  const profileAliases = occuMedDiscoverySubjects(subject)
    .filter(value => !subject.toLowerCase().includes(value.toLowerCase()))
    .slice(0, 10)

  const profileQueries = profileAliases.map(alias =>
    `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation OR tender) ${currentYear}`
  )
  const semanticQueries = aliases.map(alias =>
    `${quotedPhrase(alias)} (RFP OR RFQ OR solicitation)`
  )

  // The browser rescue executes only a small query budget. Keep the literal
  // subject, one official-site variant, and two Occu-Med vocabulary aliases in
  // the first four slots so broad wording such as “employment evaluations” does
  // not prevent searches for the terms buyers actually use.
  return Array.from(new Set([
    `${quotedSubject} (RFP OR RFQ OR solicitation OR bid OR tender) ${currentYear}`,
    `site:.gov ${quotedSubject} (RFP OR RFQ OR solicitation OR "sources sought")`,
    ...profileQueries.slice(0, 2),
    `intitle:RFP ${quotedSubject}`,
    `filetype:pdf ${quotedSubject} ("request for proposals" OR RFP OR RFQ OR IFB)`,
    ...semanticQueries,
    ...profileQueries.slice(2),
  ]))
}
