import { assessOccuMedRfpText } from './occumed-rfp-profile'
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
  const explicit = firstCapture(text, [
    /\b(?:issued by|issuing agency|issuing organization|contracting agency|procuring agency|buyer|department|agency)\s*[:\-]\s*([^.;|]{3,140})/i,
    /\b(?:city|county|town|village|state|department|authority|district|university) of\s+([A-Z][A-Za-z0-9 .,&'\-]{2,100})/,
  ], 140)
  if (explicit) return explicit

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

function serviceSummary(text: string): string[] {
  const groups: Array<[string, RegExp]> = [
    ['Employment and pre-placement medical evaluations', /\b(?:pre[- ]employment|pre[- ]placement|post[- ]offer|employment)\s+(?:medical|physical|examination|evaluation)s?\b/i],
    ['Fitness-for-duty and return-to-work evaluations', /\b(?:fitness for duty|fit for duty|return[- ]to[- ]work|medical clearance)\b/i],
    ['Deployment and medical-readiness examinations', /\b(?:deployment|medical readiness|overseas medical|oconus|contractor medical clearance)\b/i],
    ['Medical-surveillance program services', /\b(?:medical surveillance|osha surveillance|hazwoper|asbestos|silica|lead surveillance)\b/i],
    ['Audiograms and hearing-conservation testing', /\b(?:audiogram|audiometric|hearing conservation|hearing testing)\b/i],
    ['Spirometry and pulmonary-function testing', /\b(?:spirometry|pulmonary function|\bpft\b|respirator clearance)\b/i],
    ['Drug and alcohol testing', /\b(?:drug testing|drug screening|alcohol testing|toxicology)\b/i],
    ['Laboratory, TB, imaging, and ancillary testing', /\b(?:laboratory testing|blood draw|urine testing|tb testing|tuberculosis|quantiferon|chest x[- ]?ray|\bekg\b|\becg\b)\b/i],
    ['Vaccinations and travel-health services', /\b(?:vaccination|immunization|travel health|yellow fever|typhoid|rabies)\b/i],
    ['Medical review and occupational-health program administration', /\b(?:medical review|medical advisor|quality assurance|medical records review|program management|provider network coordination)\b/i],
    ['Public-safety or firefighter medical evaluations', /\b(?:firefighter|law enforcement|public safety|nfpa\s*1582)\b/i],
    ['DOT and regulated-driver examinations', /\b(?:dot physical|fmcsa|commercial driver medical)\b/i],
  ]
  return groups.filter(([, pattern]) => pattern.test(text)).map(([label]) => label).slice(0, 8)
}

function mandatoryCredentials(text: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ['Licensed physician/advanced-practice clinician', /\b(?:licensed|board[- ]certified)\s+(?:physician|medical doctor|md|do|nurse practitioner|physician assistant)\b/i],
    ['CAOHC-certified audiometry personnel', /\bcaohc\b|\bcaooch\b/i],
    ['NIOSH-approved spirometry training', /\bniosh\b[^.;]{0,60}\bspirom/i],
    ['CLIA-certified laboratory', /\bclia\b/i],
    ['FMCSA-certified medical examiner', /\bfmcsa\b[^.;]{0,70}\bcertif/i],
    ['HIPAA compliance', /\bhipaa\b/i],
    ['Accreditation or specific clinical licensure', /\b(?:accreditation|required licensure|professional license|state licensure)\b/i],
  ]
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)
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

function concernSignals(text: string, relevanceExclusions: string[], model: RfpDeliveryModel): string[] {
  const concerns = [...relevanceExclusions]
  const patterns: Array<[string, RegExp]> = [
    ['May require ownership or continuous staffing of a dedicated on-site clinic', /\b(?:own|operate|staff|manage)\s+(?:a\s+)?(?:dedicated\s+)?on[- ]?site clinic\b/i],
    ['May require direct clinical staffing rather than coordinated examinations', /\b(?:nursing|physician|clinical)\s+staffing\b|\bstaff augmentation\b/i],
    ['May require insurance billing or health-plan administration', /\b(?:insurance billing|health plan|benefits administration|claims administration)\b/i],
    ['May require immediate or unusually short turnaround', /\b(?:same[- ]day|within 24 hours|24[- ]hour turnaround|immediate turnaround)\b/i],
    ['May include treatment responsibilities beyond evaluation and documentation', /\b(?:ongoing treatment|primary care|patient treatment|therapeutic services)\b/i],
    ['May require a local physical facility in the buyer jurisdiction', /\b(?:must maintain|shall maintain|required to have)\s+(?:a\s+)?(?:local|physical)\s+(?:office|clinic|facility)\b/i],
  ]
  for (const [label, pattern] of patterns) if (pattern.test(text)) concerns.push(label)
  if (model === 'on-site') concerns.push('On-site delivery model requires operational review')
  return unique(concerns, 8)
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

function fitBand(score: number): RfpFitBand {
  if (score >= 86) return 'strong'
  if (score >= 68) return 'good'
  if (score >= 45) return 'review'
  return 'poor'
}

export function extractRfpOpportunityIntelligence(input: IntelligenceInput): RfpOpportunityIntelligence {
  const text = clean(`${input.title || ''} ${input.text}`)
  const relevance = assessOccuMedRfpText(text)
  const services = serviceSummary(text)
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
  const concerns = concernSignals(text, relevance.exclusions, model)
  const activeBonus = ['open', 'active'].includes(input.lifecycle.status) ? 12 : input.lifecycle.status === 'unknown' ? 0 : -40
  const serviceBonus = Math.min(20, services.length * 4)
  const networkBonus = model === 'distributed-provider-network' || model === 'hybrid' ? 8 : 0
  const concernPenalty = Math.min(28, concerns.length * 6)
  const rawScore = Math.round(relevance.score * 70 + activeBonus + serviceBonus + networkBonus - concernPenalty)
  const score = Math.max(0, Math.min(100, rawScore))
  const docs = input.documents || []
  const documentUrls = unique([input.url, ...docs.map(document => document.url)], 20)
  const mandatory = mandatoryCredentials(text)
  const evidence = evidenceExcerpts(text, [
    'due date', 'deadline', 'occupational health', 'medical examination', 'medical surveillance',
    'fitness for duty', 'deployment', 'provider network', 'place of performance', 'period of performance',
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
    fitScore: score,
    fitBand: fitBand(score),
    matchedCapabilities: relevance.matchedCapabilities,
    matchedBuyerSegments: relevance.matchedBuyerSegments,
    concerns,
    evidence,
    documentUrls,
    attachmentCount: Math.max(0, documentUrls.length - 1),
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
    `Documents inspected: ${intelligence.documentUrls.length}.`,
    intelligence.evidence.length ? `Evidence: ${intelligence.evidence.join(' | ')}` : '',
  ].filter(Boolean).join(' '))
}
