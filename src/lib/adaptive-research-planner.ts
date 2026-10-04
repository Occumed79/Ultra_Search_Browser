/** Retrieval-only research planning. No relevance verdicts or scores are assigned here. */
import { isIP } from 'node:net'
import { getRelevanceProfile } from './canonical-relevance'
import { matchEvidence } from './canonical/search/profileRules'
import type { RelevanceProfile } from './canonical/search/relevanceProfile'
import type { BrowserSearchVariant } from './browser-search-pipeline'
import type { CanonicalResultDecision } from './canonical-result-decision'
import type { RfpOpportunityIntelligence } from './rfp-opportunity-intelligence'
import type { SolicitationPackageAnalysis } from './solicitation-package'
import { canonicalRetrievalUrl } from './search-retrieval-coverage'
import { solicitationIdentity } from './solicitation-dedupe'
import type { ScrapedResult } from '../types/search'

export type ResearchReason = 'exact-title-followup' | 'solicitation-number-followup' | 'buyer-domain-followup' | 'portal-followup' | 'attachment-followup' | 'coverage-gap' | 'canonical-service-gap'
export interface ResearchProvenance {
  wave: number
  reason: ResearchReason
  evidenceUrls: string[]
  gap?: string
  profileVersion?: string
}
export type ResearchResult = ScrapedResult & {
  rfpIntelligence?: RfpOpportunityIntelligence
  packageAnalysis?: SolicitationPackageAnalysis
  canonicalDecision?: CanonicalResultDecision
}
export const RESEARCH_LIMITS = { waves: 3, queriesPerWave: 6, providerCallsPerWave: 18, validationTargets: 60, pagesPerWave: 12, budgetMs: 110_000 } as const

export function normalizeResearchQuery(query: string): string {
  return query.normalize('NFKC').replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()
}
function clean(value: string | undefined): string { return (value || '').replace(/["\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) }
function quote(value: string): string { return `"${clean(value)}"` }
function host(value: string): string | undefined {
  try {
    const url = new URL(value)
    const name = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isIP(name) || name.includes(':') || !name.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(name)) return undefined
    return /^[a-z0-9.-]+$/.test(name) ? name : undefined
  } catch { return undefined }
}
const FINAL_STATES = new Set(['expired', 'closed', 'cancelled', 'awarded', 'stale', 'dead', 'junk', 'duplicate'])
export function researchEvidence(results: ScrapedResult[]): ResearchResult[] {
  return (results as ResearchResult[]).filter(result => {
    const page = result.pageValidation
    return page && !FINAL_STATES.has(page.lifecycle.status)
      && result.bucket !== 'rejected' && result.bucket !== 'expired' && result.bucket !== 'dead'
      && result.canonicalDecision?.decision !== 'REJECT'
      && result.canonicalDecision?.procurementConfirmed === true
      && page.availability === 'reachable'
  })
}

export interface ResearchSnapshot {
  destinations: Set<string>
  solicitations: Set<string>
  opportunities: Set<string>
  buyers: Set<string>
  portals: Set<string>
  documents: Set<string>
}
export function researchSnapshot(results: ScrapedResult[]): ResearchSnapshot {
  const snapshot: ResearchSnapshot = { destinations: new Set(), solicitations: new Set(), opportunities: new Set(), buyers: new Set(), portals: new Set(), documents: new Set() }
  for (const result of researchEvidence(results)) {
    const url = canonicalRetrievalUrl(result.pageValidation!.finalUrl || result.url)
    if (url) snapshot.destinations.add(url)
    const identity = solicitationIdentity(result)
    snapshot.solicitations.add(identity)
    snapshot.opportunities.add(`${identity}:${result.canonicalDecision?.decision}`)
    if (result.rfpIntelligence?.organization) snapshot.buyers.add(clean(result.rfpIntelligence.organization).toLowerCase())
    const name = host(result.url)
    if (name) snapshot.portals.add(name)
    for (const doc of result.packageAnalysis?.documents || []) {
      const destination = canonicalRetrievalUrl(doc.url)
      if (doc.extracted && destination) snapshot.documents.add(destination)
    }
  }
  return snapshot
}
export function researchNovelty(previous: ResearchSnapshot, current: ResearchSnapshot) {
  const counts = Object.fromEntries((Object.keys(current) as Array<keyof ResearchSnapshot>).map(key => [key, [...current[key]].filter(value => !previous[key].has(value)).length])) as Record<keyof ResearchSnapshot, number>
  return { ...counts, meaningful: Object.values(counts).some(count => count > 0) }
}

/** Round-robin across queries and indexes so a bounded budget does not go to one provider. */
export function allocateProviderQueries<T>(queries: T[], providers: Array<{ name: string; configured: boolean; maxVariants: number }>, maxCalls: number): Map<string, T[]> {
  const allocations = new Map<string, T[]>(providers.map(provider => [provider.name, []]))
  let remaining = maxCalls
  const active = providers.filter(provider => provider.configured)
  if (!Number.isFinite(maxCalls)) {
    for (const provider of active) allocations.set(provider.name, queries.slice(0, provider.maxVariants))
    return allocations
  }
  // Give every query an execution slot before spending spare calls on corroborating indexes.
  const primary = active[0]
  if (primary) for (const query of queries.slice(0, primary.maxVariants)) {
    if (remaining <= 0) break
    allocations.get(primary.name)!.push(query)
    remaining -= 1
  }
  const secondary = active.slice(1)
  for (let offset = 0; offset < secondary.length && remaining > 0; offset += 1) {
    for (let index = 0; index < queries.length && remaining > 0; index += 1) {
      const provider = secondary[(index + offset) % secondary.length]
      const assigned = allocations.get(provider.name)!
      if (assigned.length >= provider.maxVariants || assigned.includes(queries[index])) continue
      assigned.push(queries[index])
      remaining -= 1
    }
  }
  return allocations
}

export function planAdaptiveResearch(query: string, results: ScrapedResult[], executed: ReadonlySet<string>, wave: number, profile: RelevanceProfile = getRelevanceProfile()): { searches: BrowserSearchVariant[]; gaps: string[] } {
  if (wave < 2 || wave > RESEARCH_LIMITS.waves) return { searches: [], gaps: [] }
  const evidence = researchEvidence(results)
  const gaps: string[] = []
  const candidates: BrowserSearchVariant[] = []
  const known = new Set([...executed].map(normalizeResearchQuery))
  const add = (text: string, reason: ResearchReason, urls: string[], gap?: string, purpose: BrowserSearchVariant['purpose'] = 'official') => {
    const normalized = normalizeResearchQuery(text)
    if (!normalized || known.has(normalized)) return
    known.add(normalized)
    candidates.push({ id: `w${wave}q${candidates.length + 1}`, query: text, purpose, priority: 100,
      research: { wave, reason, evidenceUrls: urls.slice(0, 4), gap, profileVersion: profile.source === 'unavailable' ? undefined : profile.version } })
  }
  const implied = profile.source === 'unavailable' ? [] : profile.categories.filter(category => matchEvidence(query, [...category.explicit, ...category.component, ...category.regulatory]).length > 0)
  const observed = new Set(evidence.flatMap(result => result.canonicalDecision?.relevance.matchedCapabilities || []))
  for (const category of implied) {
    if (observed.has(category.label)) continue
    const term = clean(category.explicit[0] || category.component[0] || category.regulatory[0])
    if (!term) continue
    gaps.push(`canonical-service:${category.id}`)
    // Keep the original user's constraints; the new wording is sourced only from Neon.
    add(`${query} ${quote(term)} (RFP OR RFQ OR solicitation)`, 'canonical-service-gap', [], `canonical-service:${category.id}`)
  }
  const federal = evidence.some(result => host(result.url) === 'sam.gov' || /\b(?:federal|united states|u\.?s\.? department)\b/i.test(result.rfpIntelligence?.organization || ''))
  const local = evidence.some(result => /\b(?:city|county|municipal|state of)\b/i.test(result.rfpIntelligence?.organization || ''))
  if (federal && !local && !/\b(?:federal|sam\.gov)\b/i.test(query)) {
    gaps.push('state-local')
    add(`${query} (city OR county OR "state of") (RFP OR solicitation) site:.gov`, 'coverage-gap', evidence.slice(0, 2).map(result => result.url), 'state-local')
  }
  if (!evidence.length) {
    gaps.push('validated-procurement-evidence')
    add(`${query} ("request for proposals" OR "sources sought") site:.gov`, 'coverage-gap', [], 'validated-procurement-evidence')
    add(`${query} (RFP OR RFQ) filetype:pdf`, 'coverage-gap', [], 'validated-procurement-evidence', 'document')
  }
  // A checked but inaccessible procurement portal can guide a site search using the user's query.
  // Its thin/blocked text does not become evidence, an identity, or novelty.
  for (const result of results as ResearchResult[]) {
    const page = result.pageValidation
    if (!page || !['unsupported', 'blocked', 'login', 'error'].includes(page.availability)
      || FINAL_STATES.has(page.lifecycle.status) || result.canonicalDecision?.decision !== 'REVIEW'
      || !result.canonicalDecision.procurementConfirmed) continue
    const domain = host(page.finalUrl || result.url)
    if (domain) add(`site:${domain} ${query} (RFP OR RFQ OR solicitation)`, 'portal-followup', [result.url], 'inaccessible-procurement-portal', 'portal')
  }
  for (const result of evidence.slice(0, 12)) {
    const info = result.rfpIntelligence
    const title = clean(info?.title || result.title)
    const number = clean(info?.solicitationNumber)
    const buyer = clean(info?.organization)
    const domain = host(result.pageValidation!.finalUrl || result.url)
    const urls = [result.url]
    const specificTitle = title.split(/\s+/).length >= 3 && /\b(?:rfp|rfq|rfi|ifb|bid|solicitation|request for|sources sought|tender)\b/i.test(title)
    const anchor = number ? quote(number) : specificTitle ? quote(title) : ''
    if (!anchor) continue
    const document = /\.(?:pdf|docx?)(?:$|[?#])/i.test(result.url) || /pdf|wordprocessingml/i.test(result.pageValidation!.contentType || '')
    const sameIdentity = evidence.filter(other => solicitationIdentity(other) === solicitationIdentity(result))
    const landing = sameIdentity.some(other => !/\.(?:pdf|docx?)(?:$|[?#])/i.test(other.url) && other.entity?.officialSource)
    if (document && !landing) {
      gaps.push(`landing-page:${anchor}`)
      add(`${anchor} ${buyer ? quote(buyer) : ''} (procurement OR solicitation)`, 'coverage-gap', urls, 'official-landing-page')
    }
    const attachments = result.packageAnalysis?.documents.filter(doc => doc.kind !== 'primary' && doc.extracted) || []
    if (!document && attachments.length === 0) {
      gaps.push(`attachments:${anchor}`)
      add(`${anchor} ${domain ? `site:${domain}` : ''} (attachment OR amendment OR addendum) filetype:pdf`, 'attachment-followup', urls, 'attachments', 'document')
    }
    // Cross-host corroboration is a retrieval gap. Search-provider overlap is not independent evidence.
    if (sameIdentity.every(other => host(other.url) === domain)) {
      gaps.push(`corroboration:${anchor}`)
      add(`${anchor} ${buyer ? quote(buyer) : ''} (solicitation OR procurement)`, 'coverage-gap', urls, 'independent-corroboration')
    }
    if (number) add(`${quote(number)} ${buyer ? quote(buyer) : ''}`, 'solicitation-number-followup', urls)
    if (specificTitle) add(quote(title), 'exact-title-followup', urls)
    if (domain) add(`site:${domain} ${anchor}`, 'buyer-domain-followup', urls)
    // Linked procurement documents supply portal hosts and exact document titles, never arbitrary page nouns.
    for (const doc of (result.packageAnalysis?.documents || []).slice(0, 6)) {
      const portal = host(doc.url)
      if (portal && buyer) add(`site:${portal} ${quote(buyer)} ${anchor}`, 'portal-followup', [result.url, doc.url], undefined, 'portal')
      if (doc.title && doc.kind !== 'other' && clean(doc.title).split(/\s+/).length >= 3) add(`${quote(doc.title)} ${anchor}`, 'attachment-followup', [result.url, doc.url], undefined, 'document')
    }
    if (domain && buyer) {
      const alternate = result.canonicalDecision?.relevance.evidence.matchedExplicitPhrases.find(term => matchEvidence(query, [term]).length === 0)
      add(`site:${domain} ${quote(buyer)} ${query} ${alternate ? quote(alternate) : ''} (RFP OR RFQ OR solicitation)`, 'portal-followup', urls, undefined, 'portal')
    }
  }
  // Reserve diversity across follow-up reasons before filling spare slots.
  const selected: BrowserSearchVariant[] = []
  for (const reason of ['canonical-service-gap', 'coverage-gap', 'solicitation-number-followup', 'exact-title-followup', 'buyer-domain-followup', 'attachment-followup', 'portal-followup'] as ResearchReason[]) {
    const candidate = candidates.find(item => item.research?.reason === reason)
    if (candidate && selected.length < RESEARCH_LIMITS.queriesPerWave) selected.push(candidate)
  }
  for (const candidate of candidates) {
    if (selected.length >= RESEARCH_LIMITS.queriesPerWave) break
    if (!selected.includes(candidate)) selected.push(candidate)
  }
  return { searches: selected, gaps: [...new Set(gaps)] }
}
