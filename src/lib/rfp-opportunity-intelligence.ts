import { assessCanonicalRelevance } from './canonical-relevance'
import type { ResultStatusAssessment } from './result-status'

export type RfpOpportunityType =
  | 'RFP'
  | 'RFQ'
  | 'RFI'
  | 'IFB'
  | 'sources-sought'
  | 'notice-of-intent'
  | 'tender'
  | 'solicitation'
  | 'bid'
  | 'unknown'

export type RfpDeliveryModel =
  | 'distributed-provider-network'
  | 'single-site'
  | 'on-site'
  | 'remote-review'
  | 'hybrid'
  | 'unknown'

export type RfpFitBand = 'strong' | 'good' | 'review' | 'poor'

export interface SolicitationDocumentEvidence {
  url: string
  title?: string
  kind: 'primary' | 'rfp' | 'amendment' | 'addendum' | 'scope' | 'pricing' | 'questions' | 'attachment' | 'other'
  extracted: boolean
  textLength: number
  contentType?: string
  reason?: string
}

export interface RfpOpportunityIntelligence {
  opportunityKey: string
  organization?: string
  solicitationNumber?: string
  opportunityType: RfpOpportunityType
  title: string
  status: ResultStatusAssessment['status']
  dueDate?: string
  questionDeadline?: string
  postedDate?: string
  placeOfPerformance?: string
  serviceSummary: string[]
  contractTerm?: string
  setAside?: string
  estimatedValue?: string
  estimatedVolume?: string
  mandatoryCredentials: string[]
  procurementContacts: Array<{ name?: string; email?: string; phone?: string }>
  deliveryModel: RfpDeliveryModel
  fitScore: number
  fitBand: RfpFitBand
  matchedCapabilities: string[]
  matchedBuyerSegments: string[]
  concerns: string[]
  evidence: string[]
  documentUrls: string[]
  attachmentCount: number
  extractedDocumentCount?: number
  confidence: number
}

interface IntelligenceInput {
  text: string
  title?: string
  url: string
  lifecycle: ResultStatusAssessment
  documents?: SolicitationDocumentEvidence[]
}

const MONTH_PATTERN = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)'
const DATE_VALUE = `(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|${MONTH_PATTERN}\\s+\\d{1,2}(?:st|nd|rd|th)?[,]?\\s+\\d{4})`

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalize(value: string): string {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function unique(values: Array<string | undefined>, limit = 12): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const cleaned = clean(value || '')
    const key = normalize(cleaned)
    if (!cleaned || !key || seen.has(key)) continue
    seen.add(key)
    output.push(cleaned)
    if (output.length >= limit) break
  }
  return output
}

function firstCapture(text: string, patterns: RegExp[], maxLength = 180): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const value = clean(match?.[1] || '')
    if (value) return value.slice(0, maxLength)
  }
  return undefined
}

function opportunityType(text: string): RfpOpportunityType {
  const value = text.toLowerCase()
  // A numbered notice type takes precedence over portal branding such as "Bid & RFP".
  const numberedType = value.match(/\b(itb|ifb|rfp|rfq|rfi)\s+[a-z0-9]*\d[a-z0-9]*(?:[-_/][a-z0-9]+)+\b/)?.[1]
  if (numberedType) return numberedType === 'itb' || numberedType === 'ifb' ? 'IFB' : numberedType.toUpperCase() as RfpOpportunityType
  if (/\brequest for proposals?\b|\brfp\b/.test(value)) return 'RFP'
  if (/\brequest for quotations?\b|\brfq\b/.test(value)) return 'RFQ'
  if (/\brequest for information\b|\brfi\b/.test(value)) return 'RFI'
  if (/\binvitation (?:for|to) bids?\b|\bifb\b/.test(value)) return 'IFB'
  if (/\bsources sought\b/.test(value)) return 'sources-sought'
  if (/\bnotice of intent\b/.test(value)) return 'notice-of-intent'
  if (/\btender\b/.test(value)) return 'tender'
  if (/\bsolicitation\b/.test(value)) return 'solicitation'
  if (/\bbid(?:ding)?\b/.test(value)) return 'bid'
  return 'unknown'
}

function extractOrganization(text: string, url: string): string | undefined {
  const issuer = text.match(/(?:^|[.!?:]\s+|\bThe\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,5}\s+(?:District|Authority|Department|County|City))\s*(?:\([^)]{0,90}\))?\s+is\s+(?:soliciting|seeking|requesting)\b/)?.[1]
  if (issuer) return clean(issuer).replace(/^The\s+/, '')
  const explicit = firstCapture(text, [
    /\b(?:issued by|issuing agency|issuing organization|contracting agency|procuring agency|buyer|department|agency)\s*[:\-]\s*([^.;|]{3,140})/i,
    /\b(?:city|county|town|village|state|department|authority|district|university) of\s+([A-Z][A-Za-z0-9 .,&'\-]{2,100})/,
  ], 140)
  if (explicit) return explicit.split(/\s+(?:type of government|category|solicitation(?:\s+(?:number|id))?|location|contact|description)\s*:/i)[0].trim()

  const buyerField = text.match(/\bbuyer\s*:?\s+(.{3,100}?)\s+(?:county|city|state|town|district)\s*[·|,]/i)?.[1]
  if (buyerField) return clean(buyerField)
  const namedCounty = text.match(/\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2}\s+County)\b/)?.[1]
  if (namedCounty) return clean(namedCounty)

  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (/\.gov$/i.test(host)) {
      const label = host.split('.')[0].replace(/[-_]+/g, ' ')
      return label.split(' ').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ')
    }
  } catch {
    // URL fallback is optional.
  }
  return undefined
}

function extractSolicitationNumber(text: string): string | undefined {
  return firstCapture(text, [
    /\b(?:solicitation|procurement|bid|rfp|rfq|rfi|ifb|tender|project|opportunity)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\-/]{2,40})/i,
    /\b(?:number|no\.?|#)\s*[:#-]\s*([A-Z]{1,8}[-_/]\d{2,}[A-Z0-9._\-/]*)/i,
    /\b(?:itb|ifb|rfp|rfq|rfi)\s+([A-Z0-9]*\d[A-Z0-9]*(?:[-_/][A-Z0-9]+)+)\b/i,
  ], 48)
}

function dateFromContext(text: string, labels: string[]): string | undefined {
  const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return firstCapture(text, [
    new RegExp(`\\b(?:${escaped})\\b[^\\n.;]{0,80}?(${DATE_VALUE})`, 'i'),
  ], 40)
}

function extractQuestionDeadline(text: string): string | undefined {
  return dateFromContext(text, [
    'questions due', 'question deadline', 'deadline for questions', 'inquiries due', 'requests for clarification due',
  ])
}

function extractPlace(text: string): string | undefined {
  return firstCapture(text, [
    /\b(?:place of performance|service location|work location|location of services|delivery location|performance location)\s*[:\-]\s*([^.;|]{3,180})/i,
    /\bservices (?:will be|are to be) (?:performed|provided|delivered) (?:at|in|throughout)\s+([^.;|]{3,160})/i,
  ], 180)
}

function extractContractTerm(text: string): string | undefined {
  return firstCapture(text, [
    /\b(?:contract term|period of performance|initial term|base period)\s*[:\-]\s*([^.;]{3,120})/i,
    /\b(?:term of|for)\s+(\d+\s+(?:year|month)s?(?:\s+with\s+[^.;]{0,80}options?)?)/i,
  ], 130)
}

function extractSetAside(text: string): string | undefined {
  return firstCapture(text, [
    /\bset[- ]aside(?: type)?\s*[:\-]\s*([^.;|]{2,100})/i,
    /\b(8\(a\)|small business|woman[- ]owned|service[- ]disabled veteran[- ]owned|hubzone|veteran[- ]owned)\s+set[- ]aside\b/i,
  ], 110)
}

function extractEstimatedValue(text: string): string | undefined {
  return firstCapture(text, [
    /\b(?:estimated|anticipated|maximum|not[- ]to[- ]exceed|contract)\s+(?:value|amount|ceiling)\s*[:\-]?\s*(\$[\d,.]+(?:\s*(?:million|billion|thousand|k|m|b))?)/i,
    /\b(?:budget|funding)\s*[:\-]?\s*(\$[\d,.]+(?:\s*(?:million|billion|thousand|k|m|b))?)/i,
  ], 60)
}

function extractEstimatedVolume(text: string): string | undefined {
  return firstCapture(text, [
    /\b(?:estimated|anticipated|approximately|up to)\s+([\d,]+\s+(?:employees?|examinees?|candidates?|examinations?|physicals?|evaluations?|tests?|appointments?)\s+(?:per|each|annually|monthly|yearly)[^.;]{0,60})/i,
    /\b([\d,]+\s+(?:employees?|examinees?|candidates?|examinations?|physicals?|evaluations?|tests?)\s+per\s+(?:year|month|week))/i,
  ], 130)
}

function mandatoryCredentials(text: string): string[] {
  return unique(text.match(/[^.;\n]{0,80}\b(?:required licensure|mandatory qualifications|must be certified|shall be licensed)\b[^.;\n]{0,120}/gi) || [])
}

function contacts(text: string): Array<{ name?: string; email?: string; phone?: string }> {
  const emails = unique(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [], 4)
  const phones = unique(text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [], 4)
  const names = unique(Array.from(text.matchAll(/\b(?:contact|procurement officer|contracting officer|buyer)\s*[:\-]\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/g)).map(match => match[1]), 4)
  const count = Math.max(emails.length, phones.length, names.length)
  return Array.from({ length: Math.min(4, count) }, (_, index) => ({
    name: names[index],
    email: emails[index],
    phone: phones[index],
  })).filter(contact => contact.name || contact.email || contact.phone)
}

function deliveryModel(text: string): RfpDeliveryModel {
  const distributed = /\b(?:nationwide|statewide|worldwide|global|multiple locations|multi[- ]location|provider network|network of clinics|throughout the (?:state|country|world))\b/i.test(text)
  const onSite = /\b(?:on[- ]site clinic|onsite clinic|dedicated clinic|staffed clinic|at the agency'?s facility|at client locations?)\b/i.test(text)
  const remote = /\b(?:remote medical review|virtual review|records review|telehealth|desktop review)\b/i.test(text)
  const single = /\b(?:single location|one location|at the following facility|at [^.;]{0,80} clinic)\b/i.test(text)
  if (distributed && onSite) return 'hybrid'
  if (distributed) return 'distributed-provider-network'
  if (onSite) return 'on-site'
  if (remote) return 'remote-review'
  if (single) return 'single-site'
  return 'unknown'
}

function evidenceExcerpts(text: string, terms: string[]): string[] {
  const normalized = clean(text)
  const lower = normalized.toLowerCase()
  const excerpts: string[] = []
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase())
    if (index < 0) continue
    excerpts.push(clean(normalized.slice(Math.max(0, index - 90), Math.min(normalized.length, index + 260))))
    if (excerpts.length >= 5) break
  }
  return unique(excerpts, 5)
}

function keyPart(value: string | undefined): string {
  return normalize(value || '').replace(/\s+/g, '-').slice(0, 90)
}

export function extractRfpOpportunityIntelligence(input: IntelligenceInput): RfpOpportunityIntelligence {
  const text = clean(`${input.title || ''} ${input.text}`)
  const relevance = assessCanonicalRelevance({ title: input.title, description: input.text })
  const services = relevance.matchedCapabilities
  const organization = extractOrganization(text, input.url)
  const solicitationNumber = extractSolicitationNumber(text)
  const title = clean(input.title || firstCapture(text, [
    /\b(?:project title|solicitation title|opportunity title|title)\s*[:\-]\s*([^.;|]{5,180})/i,
  ], 180) || services[0] || 'Procurement opportunity')
  const dueDate = input.lifecycle.dates
    .filter(date => ['due', 'closing', 'expiration'].includes(date.kind) && date.iso)
    .sort((left, right) => String(right.iso).localeCompare(String(left.iso)))[0]?.iso?.slice(0, 10)
  const postedDate = input.lifecycle.dates
    .filter(date => ['posted', 'modified'].includes(date.kind) && date.iso)
    .sort((left, right) => String(right.iso).localeCompare(String(left.iso)))[0]?.iso?.slice(0, 10)
  const model = deliveryModel(text)
  const concerns = relevance.exclusions
  const docs = input.documents || []
  const documentUrls = unique([input.url, ...docs.map(document => document.url)], 20)
  const mandatory = mandatoryCredentials(text)
  const evidence = evidenceExcerpts(text, [
    'due date', 'deadline', 'place of performance', 'period of performance',
    ...relevance.evidence.matchedExplicitPhrases,
  ])
  const confidenceSignals = [
    solicitationNumber, organization, dueDate, services.length > 0 ? 'services' : undefined,
    docs.some(document => document.extracted) ? 'documents' : undefined,
  ].filter(Boolean).length
  const confidence = Math.min(0.98, 0.45 + confidenceSignals * 0.1 + Math.min(0.12, evidence.length * 0.02))
  const opportunityKey = [
    keyPart(organization),
    keyPart(solicitationNumber),
    keyPart(title),
    dueDate || '',
  ].filter(Boolean).join('|') || keyPart(input.url)

  return {
    opportunityKey,
    organization,
    solicitationNumber,
    opportunityType: opportunityType(text),
    title,
    status: input.lifecycle.status,
    dueDate,
    questionDeadline: extractQuestionDeadline(text),
    postedDate,
    placeOfPerformance: extractPlace(text),
    serviceSummary: services,
    contractTerm: extractContractTerm(text),
    setAside: extractSetAside(text),
    estimatedValue: extractEstimatedValue(text),
    estimatedVolume: extractEstimatedVolume(text),
    mandatoryCredentials: mandatory,
    procurementContacts: contacts(text),
    deliveryModel: model,
    fitScore: relevance.score,
    fitBand: relevance.verdict === 'accept' ? 'good' : relevance.verdict === 'review' ? 'review' : 'poor',
    matchedCapabilities: relevance.matchedCapabilities,
    matchedBuyerSegments: relevance.matchedBuyerSegments,
    concerns,
    evidence,
    documentUrls,
    attachmentCount: Math.max(0, documentUrls.length - 1),
    extractedDocumentCount: docs.filter(document => document.extracted && document.textLength > 0).length,
    confidence: Number(confidence.toFixed(2)),
  }
}

export function structuredRfpReviewText(intelligence: RfpOpportunityIntelligence): string {
  return clean([
    `Opportunity type: ${intelligence.opportunityType}.`,
    intelligence.organization ? `Buyer: ${intelligence.organization}.` : '',
    intelligence.solicitationNumber ? `Solicitation number: ${intelligence.solicitationNumber}.` : '',
    `Lifecycle status: ${intelligence.status}.`,
    intelligence.dueDate ? `Response deadline: ${intelligence.dueDate}.` : 'Response deadline: not confirmed.',
    intelligence.questionDeadline ? `Questions deadline: ${intelligence.questionDeadline}.` : '',
    intelligence.placeOfPerformance ? `Place of performance: ${intelligence.placeOfPerformance}.` : '',
    intelligence.serviceSummary.length ? `Services: ${intelligence.serviceSummary.join('; ')}.` : '',
    intelligence.contractTerm ? `Contract term: ${intelligence.contractTerm}.` : '',
    intelligence.deliveryModel ? `Delivery model: ${intelligence.deliveryModel}.` : '',
    intelligence.mandatoryCredentials.length ? `Mandatory qualifications: ${intelligence.mandatoryCredentials.join('; ')}.` : '',
    `Occu-Med fit: ${intelligence.fitBand} (${intelligence.fitScore}/100).`,
    intelligence.matchedCapabilities.length ? `Matched capabilities: ${intelligence.matchedCapabilities.join('; ')}.` : '',
    intelligence.concerns.length ? `Potential disqualifiers or concerns: ${intelligence.concerns.join('; ')}.` : 'No hard scope concern detected.',
    `Document links: ${intelligence.documentUrls.length}. Documents extracted: ${intelligence.extractedDocumentCount ?? 'not confirmed'}.`,
    intelligence.evidence.length ? `Evidence: ${intelligence.evidence.join(' | ')}` : '',
  ].filter(Boolean).join(' '))
}
