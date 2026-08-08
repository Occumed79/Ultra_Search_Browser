import type { SemanticIntentPlan } from './semantic-intent'

export const OCCUMED_PROFILE_VERSION = '2026-08-08'

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
      'employment medical evaluation', 'employment physical', 'pre employment physical',
      'pre-employment physical', 'pre placement medical', 'pre-placement medical',
      'post offer medical', 'post-offer medical', 'fitness for duty', 'fit for duty',
      'return to work evaluation', 'return-to-work evaluation', 'return to work', 'return-to-work',
      'job specific medical evaluation', 'job-specific medical evaluation',
      'job specific medical evaluations', 'job-specific medical evaluations',
      'medical clearance', 'medical screening services', 'employee medical examination',
      'employee medical examinations', 'pre employment medical examination',
      'pre-employment medical examination',
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
    ],
  },
  {
    label: 'medical surveillance and regulated workforce programs',
    terms: [
      'medical surveillance', 'osha medical surveillance', 'periodic medical examination',
      'periodic physical examination', 'respirator medical evaluation', 'respirator medical clearance',
      'respirator clearance', 'respirator fit testing', 'hearing conservation',
      'audiometric testing', 'audiometry', 'audiogram', 'spirometry',
      'pulmonary function test', 'pft', 'silica surveillance',
      'asbestos surveillance', 'hazwoper medical', 'hazmat medical', 'lead surveillance',
      'fmcsr medical', 'fmcsa medical', 'dot physical', 'commercial driver medical',
    ],
  },
  {
    label: 'ancillary occupational testing and examination coordination',
    terms: [
      'drug testing', 'drug screening', 'alcohol testing', 'laboratory testing',
      'blood draw', 'urine testing', 'tuberculosis testing', 'tb testing', 'quantiferon',
      'chest x ray', 'chest x-ray', 'electrocardiogram', 'ekg', 'ecg',
      'vision testing', 'hearing testing', 'immunization services', 'vaccination services',
      'dental readiness', 'dental examination', 'specialty medical examination',
    ],
  },
  {
    label: 'medical review and program administration',
    terms: [
      'medical review', 'medical case review', 'medical advisor services',
      'fitness determination', 'placement recommendation', 'accommodation review',
      'job compatibility assessment', 'job demands analysis', 'exam quality assurance',
      'quality assurance review', 'medical records review', 'medical record review',
      'medical waiver support', 'provider network coordination', 'provider-network coordination',
      'nationwide provider network', 'global provider network',
      'multi location medical exams', 'multi-location medical exams',
      'occupational health program management', 'medical surveillance program management',
    ],
  },
] as const

export const OCCUMED_BUYER_SEGMENTS = [
  'defense contractor', 'government contractor', 'federal contractor', 'public agency',
  'municipality', 'county government', 'state agency', 'special district', 'university',
  'public safety', 'law enforcement', 'fire department', 'fire district', 'ems',
  'safety sensitive workforce', 'safety-sensitive workforce', 'industrial workforce',
  'construction workforce', 'environmental remediation', 'oil and gas', 'mining',
  'utilities', 'transportation', 'aviation maintenance', 'maritime', 'offshore',
  'security contractor', 'overseas workforce', 'deployed personnel',
] as const

export const OCCUMED_HARD_EXCLUSIONS = [
  'medical equipment purchase', 'medical supplies purchase',
  'pharmaceutical purchase', 'pharmaceutical supply', 'pharmaceutical drugs',
  'prescription drug purchase', 'prescription drug supply', 'medication supply',
  'wholesale pharmaceutical', 'drug distribution',
  'health insurance', 'benefits administration',
  'hospital construction', 'clinic construction', 'information technology system',
  'electronic health record system', 'ehr software', 'medical billing software',
  'general nursing staffing', 'hospital staffing', 'physician staffing',
  'inpatient treatment', 'community behavioral health treatment', 'patient treatment services',
  'ambulance purchase', 'laboratory equipment', 'protective equipment purchase',
  'grant opportunity', 'job opening', 'career opportunity', 'award notice',
  'bid tabulation', 'vendor registration only',
] as const

export const OCCUMED_POSITIVE_EXAMPLES = [
  'Employee occupational-health services including physicals, surveillance, testing, and fitness evaluations.',
  'Medical readiness examinations for deployed or deployable personnel.',
  'Firefighter NFPA medical evaluations or comparable public-safety fitness examinations.',
  'Nationwide or international employee-health screening network coordination.',
  'Medical-advisor, clinical-review, fitness-for-duty, or accommodation-review services.',
  'Periodic OSHA medical surveillance, respirator clearance, audiograms, spirometry, laboratory testing, or immunizations.',
] as const

export const OCCUMED_NEGATIVE_EXAMPLES = [
  'Hospital nursing-staff contract: general clinical staffing rather than employment evaluations.',
  'Medical gloves or equipment purchase: commodity procurement.',
  'Community behavioral-health treatment: patient treatment rather than workforce evaluation.',
  'Health-insurance administration: benefits and insurance rather than occupational medicine.',
  'A relevant occupational-health solicitation whose deadline has passed: expired and never displayable.',
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
  const capabilityEvidence = OCCUMED_CAPABILITY_GROUPS.map(group => ({
    label: group.label,
    terms: matchingTerms(text, group.terms),
  })).filter(group => group.terms.length > 0)
  const matchedCapabilities = capabilityEvidence.map(group => group.label)
  const matchedBuyerSegments = matchingTerms(text, OCCUMED_BUYER_SEGMENTS)
  const exclusions = matchingTerms(text, OCCUMED_HARD_EXCLUSIONS)
  const strongSingleFamilyEvidence = capabilityEvidence.some(group => group.terms.length >= 2)
  const matchedTermCount = capabilityEvidence.reduce((total, group) => total + group.terms.length, 0)

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

  // A buyer does not need to request two unrelated capability families to be a
  // legitimate Occu-Med opportunity. A focused audiometry, respirator-clearance,
  // drug-testing, or fitness-for-duty solicitation can be a strong fit when its
  // scope contains multiple concrete terms from one supported family.
  if (
    matchedCapabilities.length >= 2
    || strongSingleFamilyEvidence
    || (matchedCapabilities.length >= 1 && matchedBuyerSegments.length >= 1)
  ) {
    return {
      status: 'relevant',
      score: Math.min(1, 0.62 + matchedCapabilities.length * 0.1 + Math.min(4, matchedTermCount) * 0.035 + matchedBuyerSegments.length * 0.04),
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
  hardExclusions: OCCUMED_HARD_EXCLUSIONS,
  positiveExamples: OCCUMED_POSITIVE_EXAMPLES,
  negativeExamples: OCCUMED_NEGATIVE_EXAMPLES,
} as const
