import type { RfpOpportunityIntelligence } from './rfp-opportunity-intelligence'
import type { ScrapedResult } from '../types/search'

export type RfpResult = ScrapedResult & {
  rfpIntelligence?: RfpOpportunityIntelligence
}

export interface SolicitationDedupeOutcome {
  results: ScrapedResult[]
  duplicates: ScrapedResult[]
  duplicateCount: number
}

function normalize(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(?:request for proposals?|request for quotations?|solicitation|procurement|rfp|rfq|rfi|ifb|bid|tender)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedUrl(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.hash = ''
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^(?:utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key)
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return value.trim()
  }
}

function identity(result: RfpResult): string {
  const intelligence = result.rfpIntelligence
  const number = normalize(intelligence?.solicitationNumber)
  const buyer = normalize(intelligence?.organization)
  if (number) return `number:${buyer || normalize(result.domain)}:${number}`

  const title = normalize(intelligence?.title || result.title)
    .split(' ')
    .filter(token => token.length >= 3)
    .slice(0, 14)
    .join(' ')
  const due = intelligence?.dueDate || result.pageValidation?.lifecycle.dates
    .find(date => ['due', 'closing', 'expiration'].includes(date.kind) && date.iso)?.iso?.slice(0, 10) || ''
  if (title) return `title:${buyer || normalize(result.domain)}:${title}:${due}`
  return `url:${normalizedUrl(result.url).toLowerCase()}`
}

function sourceSet(result: ScrapedResult): string[] {
  return Array.from(new Set([
    result.source,
    ...(result.retrieval?.sources || []),
    ...(result.entity?.alternateSources || []),
  ].filter(Boolean)))
}

function mergeIntelligence(primary: RfpResult, duplicate: RfpResult): RfpOpportunityIntelligence | undefined {
  const left = primary.rfpIntelligence
  const right = duplicate.rfpIntelligence
  if (!left) return right
  if (!right) return left

  const better = left.confidence >= right.confidence ? left : right
  const other = better === left ? right : left
  return {
    ...other,
    ...better,
    serviceSummary: Array.from(new Set([...left.serviceSummary, ...right.serviceSummary])),
    mandatoryCredentials: Array.from(new Set([...left.mandatoryCredentials, ...right.mandatoryCredentials])),
    procurementContacts: [...left.procurementContacts, ...right.procurementContacts]
      .filter((contact, index, values) => values.findIndex(candidate =>
        `${candidate.email || ''}|${candidate.phone || ''}|${candidate.name || ''}` === `${contact.email || ''}|${contact.phone || ''}|${contact.name || ''}`
      ) === index)
      .slice(0, 6),
    matchedCapabilities: Array.from(new Set([...left.matchedCapabilities, ...right.matchedCapabilities])),
    matchedBuyerSegments: Array.from(new Set([...left.matchedBuyerSegments, ...right.matchedBuyerSegments])),
    concerns: Array.from(new Set([...left.concerns, ...right.concerns])),
    evidence: Array.from(new Set([...left.evidence, ...right.evidence])).slice(0, 8),
    documentUrls: Array.from(new Set([...left.documentUrls, ...right.documentUrls, primary.url, duplicate.url])),
    attachmentCount: Math.max(0, new Set([...left.documentUrls, ...right.documentUrls, primary.url, duplicate.url]).size - 1),
    fitScore: Math.max(left.fitScore, right.fitScore),
    fitBand: left.fitScore >= right.fitScore ? left.fitBand : right.fitBand,
    confidence: Math.max(left.confidence, right.confidence),
  }
}

function mergeResult(primary: RfpResult, duplicate: RfpResult): RfpResult {
  const alternateUrls = Array.from(new Set([
    ...(primary.entity?.alternateUrls || []),
    ...(duplicate.entity?.alternateUrls || []),
    primary.url,
    duplicate.url,
  ].map(normalizedUrl)))
  const sources = Array.from(new Set([...sourceSet(primary), ...sourceSet(duplicate)]))
  const preferred = primary.score >= duplicate.score ? primary : duplicate
  const other = preferred === primary ? duplicate : primary

  return {
    ...other,
    ...preferred,
    description: preferred.description.length >= other.description.length ? preferred.description : other.description,
    score: Math.max(primary.score, duplicate.score) + Math.min(8, Math.max(0, sources.length - 1) * 2),
    retrieval: {
      sources,
      queries: Array.from(new Set([...(primary.retrieval?.queries || []), ...(duplicate.retrieval?.queries || [])])),
      purposes: Array.from(new Set([...(primary.retrieval?.purposes || []), ...(duplicate.retrieval?.purposes || []), 'solicitation-dedupe'])),
      overlap: sources.length,
    },
    entity: {
      fingerprint: identity(primary),
      confirmationCount: sources.length,
      alternateUrls: alternateUrls.filter(url => url !== normalizedUrl(preferred.url)),
      alternateSources: sources.filter(source => source !== preferred.source),
      officialSource: Boolean(primary.entity?.officialSource || duplicate.entity?.officialSource || /\.gov(?:\/|$)/i.test(primary.url) || /\.gov(?:\/|$)/i.test(duplicate.url)),
    },
    rfpIntelligence: mergeIntelligence(primary, duplicate),
  }
}

export function deduplicateSolicitations(results: ScrapedResult[]): SolicitationDedupeOutcome {
  const canonical = new Map<string, RfpResult>()
  const duplicates: ScrapedResult[] = []

  for (const raw of results as RfpResult[]) {
    const key = identity(raw)
    const existing = canonical.get(key)
    if (!existing) {
      canonical.set(key, {
        ...raw,
        url: normalizedUrl(raw.url),
        entity: {
          fingerprint: key,
          confirmationCount: Math.max(1, raw.entity?.confirmationCount || sourceSet(raw).length),
          alternateUrls: raw.entity?.alternateUrls || [],
          alternateSources: raw.entity?.alternateSources || [],
          officialSource: Boolean(raw.entity?.officialSource || /\.gov(?:\/|$)/i.test(raw.url)),
        },
      })
      continue
    }

    duplicates.push({
      ...raw,
      bucket: 'duplicate',
      entity: {
        fingerprint: key,
        confirmationCount: existing.entity?.confirmationCount || 1,
        alternateUrls: existing.entity?.alternateUrls || [],
        alternateSources: existing.entity?.alternateSources || [],
        officialSource: existing.entity?.officialSource || false,
        duplicateOf: existing.url,
      },
    })
    canonical.set(key, mergeResult(existing, raw))
  }

  const deduped = Array.from(canonical.values())
    .sort((left, right) => right.score - left.score)
    .map((result, index) => ({ ...result, rank: index + 1 }))

  return {
    results: deduped,
    duplicates,
    duplicateCount: duplicates.length,
  }
}
