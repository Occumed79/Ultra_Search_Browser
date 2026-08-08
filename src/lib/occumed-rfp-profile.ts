import type { SemanticIntentPlan } from './semantic-intent'

export const OCCUMED_PROFILE_VERSION = '2026-08-08-award-history-v1'

export const OCCUMED_OFFICIAL_SOURCES = [
  'https://www.occu-med.com/',
  'https://www.occu-med.com/what-we-do/',
  'https://www.occu-med.com/who-we-serve/',
  'https://www.occu-med.com/our-network/',
] as const

/**
 * Existing client organizations are similarity anchors, not a requirement that
 * the buyer itself be one of these companies. They teach the relevance engine
 * which industries, workforce patterns, and contract environments Occu-Med
 * already supports.
 */
export const OCCUMED_CLIENT_ANCHORS = [
  'V2X',
  'Vectrus',
  'Amentum',
  'Leidos',
  'ManTech',
  'CACI',
  'Constellis',
  'GDIT',
  'General Dynamics Information Technology',
  'IAP Worldwide Services',
  'Trace Systems',
  'Valiant Integrated Services',
  'IDS International',
  'Alutiiq',
  'ASRC Federal',
  'Weatherford International',
  'Fluor',
  'KBR',
  'Versar Global Solutions',
  'Sierra Nevada Corporation',
  'SNC',
  'Freeport-McMoRan',
  'FCX',
  'BAE Systems',
  'GardaWorld Federal Services',
  'Garda-Fed',
  'World Vision International',
] as const

export const OCCUMED_CAPABILITY_GROUPS = [
  {
    label: 'employment and occupational medical evaluations',
    terms: [
      'occupational health', 'occupational medicine', 'employee health', 'workforce health',
      'occupational health exams', 'occupational health examination', 'job-related medical examinations',
      'employment medical evaluation', 'employment physical', 'pre employment physical',
      'pre-employment physical', 'pre-employment physicals', 'pre-employment exams',
      'pre placement medical', 'pre-placement medical', 'pre-placement physical exams',
      'post offer medical', 'post-offer medical', 'periodic employee exams', 'exit physical exams',
      'termination exams', 'fitness for duty', 'fit for duty', 'fitness-for-duty evaluations',
      'return to work evaluation', 'return-to-work evaluation', 'return-to-duty reviews',
      'medical clearance', 'medical screening services', 'employee medical examinations',
      'medical examinations and fitness determinations',
    ],
  },
  {
    label: 'deployment and medical readiness',
    terms: [
      'deployment medical', 'pre deployment health assessment', 'pre-deployment health assessment',
      'post deployment health assessment', 'post-deployment health assessment',
      'deployment readiness', 'medical readiness', 'military medical screening',
      'dod medical examination', 'department of state medical', 'overseas medical clearance',
      'oconus medical', 'contractor medical clearance', 'travel health assessment',
      'global immunization', 'travel vaccination', 'deployment vaccination',
      'mass medical screening', 'contractor workforce screening', 'overseas workforce medical screening',
    ],
  },
  {
    label: 'medical surveillance and regulated workforce programs',
    terms: [
      'medical surveillance', 'medical surveillance services', 'medical surveillance exams',
      'medical surveillance testing services', 'occupational health medical surveillance exams',
      'osha medical surveillance', 'periodic medical examination', 'periodic physical examination',
      'respirator medical clearance', 'respirator clearance', 'respirator fit testing',
      'hearing conservation', 'audiometric testing', 'audiogram', 'audiometry',
      'audiology consultation', 'audiology consultations', 'spirometry', 'spirometry testing',
      'pulmonary function test', 'pft', 'silica surveillance', 'asbestos surveillance',
      'hazwoper medical', 'hazmat medical', 'lead surveillance', 'cancer screening',
      'fmcsr medical', 'fmcsa medical', 'dot physical', 'dot physicals',
      'dot dmv medical exams', 'commercial driver medical',
    ],
  },
  {
    label: 'ancillary occupational testing and examination coordination',
    terms: [
      'drug testing', 'drug screening', 'alcohol testing', 'laboratory testing',
      'laboratory work', 'laboratory diagnostics', 'lab services', 'blood draw',
      'urine testing', 'tuberculosis testing', 'tb testing', 'quantiferon',
      'chest x ray', 'chest x-ray', 'electrocardiogram', 'ekg', 'ecg',
      'vision testing', 'hearing testing', 'vision and hearing testing',
      'immunization services', 'vaccination services', 'dental readiness',
      'dental examination', 'specialty medical examination',
    ],
  },
  {
    label: 'medical review and program administration',
    terms: [
      'medical review', 'medical case review', 'medical advisor services',
      'record and case review', 'medical review and consultation',
      'fitness determination', 'fitness determination services', 'placement recommendation',
      'accommodation review', 'job compatibility assessment', 'job demands analysis',
      'exam quality assurance', 'quality assurance review', 'medical records review',
      'medical waiver support', 'provider network coordination', 'nationwide provider network',
      'global provider network', 'nationwide medical exam locations',
      'multi location medical exams', 'multi-location medical exams',
      'clinics throughout the state', 'occupational health program management',
      'medical surveillance program management', 'professional occupational health consulting services',
      'occupational health consulting', 'medical surveillance reporting',
    ],
  },
] as const

export const OCCUMED_BUYER_SEGMENTS = [
  'defense contractor', 'government contractor', 'federal contractor', 'public agency',
  'municipality', 'county government', 'state agency', 'special district', 'university',
  'public safety', 'law enforcement', 'federal law enforcement', 'protective service division',
  'firefighter', 'fire department', 'fire district', 'ems', 'army national guard',
  'national guard', 'army corps of engineers', 'usace', 'forest service',
  'safety sensitive workforce', 'safety-sensitive workforce', 'industrial workforce',
  'construction workforce', 'environmental remediation', 'oil and gas', 'mining',
  'utilities', 'utility workforce', 'transportation', 'aviation maintenance',
  'maritime', 'offshore', 'security contractor', 'overseas workforce', 'deployed personnel',
] as const

export const OCCUMED_HARD_EXCLUSIONS = [
  'medical equipment purchase', 'medical supplies purchase', 'pharmaceutical purchase',
  'prescription drug purchase', 'health insurance', 'benefits administration',
  'hospital construction', 'clinic construction', 'information technology system',
  'electronic health record system', 'ehr software', 'medical billing software',
  'general nursing staffing', 'hospital staffing', 'physician staffing',
  'inpatient treatment', 'community behavioral health treatment', 'patient treatment services',
  'ambulance purchase', 'laboratory equipment', 'protective equipment purchase',
  'grant opportunity', 'job opening', 'career opportunity', 'award notice',
  'bid tabulation', 'vendor registration only',
] as const

/**
 * These are compressed examples of publicly documented Occu-Med wins and
 * performance records. They are relevance examples only; historical award
 * pages remain excluded from the live opportunity list.
 */
export const OCCUMED_VERIFIED_WIN_EXAMPLES = [
  'Department of Transportation protective-service medical examinations and fitness determinations: pre-employment, periodic, return-to-duty and fitness-for-duty exams with vision, hearing, labs, EKG and spirometry through nationwide exam locations.',
  'Army National Guard occupational health exams: job-related periodic, new-hire, exit and termination examinations, medical surveillance, audiology, labs and medical review.',
  'Army and USACE medical-surveillance programs: recurring physical exams, occupational testing, laboratory services, audiometry, spirometry and reporting across multiple locations.',
  'CISA medical surveillance support: pre-placement, periodic and exit physicals; return-to-work and fit-for-duty exams; record and case review.',
  'Forest Service firefighter medical service exams and other public-safety occupational medical evaluations.',
  'Municipal and county contracts for pre-employment physicals, DOT/DMV medical exams, occupational medicine, employee examinations and occupational-health consulting.',
  'Defense-prime fit-for-duty medical-services subcontracts and overseas contractor workforce screening, including mass screening of deployed/base-operations personnel.',
] as const

export const OCCUMED_POSITIVE_EXAMPLES = [
  ...OCCUMED_VERIFIED_WIN_EXAMPLES,
  'Employee occupational-health services including physicals, surveillance, testing, and fitness evaluations.',
  'Medical readiness examinations for deployed or deployable personnel.',
  'Nationwide or international employee-health screening network coordination.',
  'Medical-advisor, clinical-review, fitness-for-duty, or accommodation-review services.',
] as const

export const OCCUMED_NEGATIVE_EXAMPLES = [
  'Hospital nursing-staff contract: general clinical staffing rather than employment evaluations.',
  'Medical gloves or equipment purchase: commodity procurement.',
  'Community behavioral-health treatment: patient treatment rather than workforce evaluation.',
  'Health-insurance administration: benefits and insurance rather than occupational medicine.',
  'A relevant occupational-health solicitation whose deadline has passed: expired and never displayable.',
  'An Occu-Med award notice or historical contract record: useful similarity evidence, but never a current bid opportunity.',
] as const

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchingTerms(text: string, terms: readonly string[]): string[] {
  const normalized = normalize(text)
  return terms.filter(term => normalized.includes(normalize(term)))
}

export interface OccuMedRelevanceAssessment {
  status: 'relevant' | 'uncertain' | 'irrelevant'
  score: number
  matchedCapabilities: string[]
  matchedBuyerSegments: string[]
  exclusions: string[]
  reason: string
}

export function assessOccuMedRfpText(text: string): OccuMedRelevanceAssessment {
  const matchedCapabilities = OCCUMED_CAPABILITY_GROUPS
    .filter(group => matchingTerms(text, group.terms).length > 0)
    .map(group => group.label)
  const matchedBuyerSegments = matchingTerms(text, OCCUMED_BUYER_SEGMENTS)
  const exclusions = matchingTerms(text, OCCUMED_HARD_EXCLUSIONS)

  if (exclusions.length > 0 && matchedCapabilities.length === 0) {
    return {
      status: 'irrelevant',
      score: 0,
      matchedCapabilities,
      matchedBuyerSegments,
      exclusions,
      reason: `Outside Occu-Med's service model: ${exclusions.slice(0, 3).join(', ')}.`,
    }
  }

  if (matchedCapabilities.length >= 2 || (matchedCapabilities.length >= 1 && matchedBuyerSegments.length >= 1)) {
    return {
      status: 'relevant',
      score: Math.min(1, 0.62 + matchedCapabilities.length * 0.1 + matchedBuyerSegments.length * 0.04),
      matchedCapabilities,
      matchedBuyerSegments,
      exclusions,
      reason: `Matches Occu-Med capabilities: ${matchedCapabilities.join(', ')}${matchedBuyerSegments.length ? `; buyer/use-case signals: ${matchedBuyerSegments.slice(0, 4).join(', ')}` : ''}.`,
    }
  }

  if (matchedCapabilities.length === 1) {
    return {
      status: 'uncertain',
      score: 0.52,
      matchedCapabilities,
      matchedBuyerSegments,
      exclusions,
      reason: `Possible Occu-Med fit through ${matchedCapabilities[0]}, but additional page evidence is required.`,
    }
  }

  return {
    status: 'irrelevant',
    score: 0.08,
    matchedCapabilities,
    matchedBuyerSegments,
    exclusions,
    reason: 'The page does not show a service that Occu-Med performs or coordinates.',
  }
}

export function augmentOccuMedSemanticIntent(
  intent?: SemanticIntentPlan
): SemanticIntentPlan | undefined {
  if (!intent) return undefined

  const capabilityTerms = OCCUMED_CAPABILITY_GROUPS.flatMap(group => group.terms)
  const clientContext = OCCUMED_CLIENT_ANCHORS.join(', ')
  const websiteContext = OCCUMED_OFFICIAL_SOURCES.join(', ')
  const winContext = OCCUMED_VERIFIED_WIN_EXAMPLES.join(' ')
  const occuMedGroup = {
    id: 'occumed-capable-service',
    label: 'Occu-Med capable service',
    terms: Array.from(new Set(capabilityTerms)),
    kind: 'subject' as const,
    required: true,
    weight: 1.4,
  }

  return {
    ...intent,
    interpretation: [
      intent.interpretation,
      'Evaluate only active procurement opportunities that Occu-Med could perform or coordinate.',
      'Occu-Med is a global employment-evaluation and occupational-health program administrator with a distributed provider network; it does not need to own every clinic or directly employ every examining provider.',
      `Official capability sources: ${websiteContext}.`,
      `Existing-client similarity anchors: ${clientContext}.`,
      `Verified historical win patterns: ${winContext}`,
      'Historical awards are similarity evidence only. Never treat an award notice, expired solicitation, or closed historical record as an active opportunity.',
    ].join(' '),
    requiredConcepts: Array.from(new Set([...intent.requiredConcepts, occuMedGroup.label])),
    conceptGroups: [
      ...intent.conceptGroups.filter(group => group.id !== occuMedGroup.id),
      occuMedGroup,
    ],
    exclusions: Array.from(new Set([
      ...intent.exclusions,
      ...OCCUMED_HARD_EXCLUSIONS,
      'expired opportunity', 'closed solicitation', 'cancelled solicitation',
      'awarded contract', 'archived notice', 'past response deadline',
    ])),
  }
}

export const OCCUMED_AI_PROFILE = {
  version: OCCUMED_PROFILE_VERSION,
  officialSources: OCCUMED_OFFICIAL_SOURCES,
  operatingModel: 'Global employment-evaluation and occupational-health program administrator using a distributed provider network. Occu-Med may coordinate services through partner clinics and specialists rather than directly owning every service location.',
  capabilityGroups: OCCUMED_CAPABILITY_GROUPS,
  buyerSegments: OCCUMED_BUYER_SEGMENTS,
  clientSimilarityAnchors: OCCUMED_CLIENT_ANCHORS,
  verifiedWinExamples: OCCUMED_VERIFIED_WIN_EXAMPLES,
  hardExclusions: OCCUMED_HARD_EXCLUSIONS,
  positiveExamples: OCCUMED_POSITIVE_EXAMPLES,
  negativeExamples: OCCUMED_NEGATIVE_EXAMPLES,
} as const
