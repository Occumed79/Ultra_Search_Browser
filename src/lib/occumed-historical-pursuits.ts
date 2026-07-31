export type OccuMedHistoricalEvidenceType =
  | 'active-client-program'
  | 'documented-service-pattern'

export interface OccuMedHistoricalPursuitSeed {
  client: string
  aliases: string[]
  program: string
  evidenceType: OccuMedHistoricalEvidenceType
  servicePatterns: string[]
  notes: string
}

/**
 * Seeded from the uploaded Occu-Med client/program intelligence and operational
 * materials. These records are fit evidence, not claims that a specific public
 * solicitation was won or lost. Future pursued/won/lost records can be added
 * without changing the decision engine.
 */
export const OCCUMED_HISTORICAL_PURSUIT_SEEDS: OccuMedHistoricalPursuitSeed[] = [
  {
    client: 'V2X',
    aliases: ['Vectrus'],
    program: 'LOGCAP V and AFCAP workforce support',
    evidenceType: 'active-client-program',
    servicePatterns: [
      'pre-deployment medical examinations',
      'periodic deployment medical evaluations',
      'medical readiness',
      'worldwide provider coordination',
      'audiograms and ancillary testing',
      'travel vaccinations',
    ],
    notes: 'Comparable opportunities involving globally distributed defense-contractor personnel are strong Occu-Med fits.',
  },
  {
    client: 'Amentum',
    aliases: [],
    program: 'T-44 NAVMED and deployed-workforce support',
    evidenceType: 'active-client-program',
    servicePatterns: [
      'naval aviation medical examinations',
      'pre-employment medical evaluations',
      'deployment medical readiness',
      'multi-location examination coordination',
    ],
    notes: 'Aviation, defense, base-operations, and overseas-workforce medical programs are comparable.',
  },
  {
    client: 'GDIT',
    aliases: ['General Dynamics Information Technology'],
    program: 'CTSS and overseas contractor support',
    evidenceType: 'active-client-program',
    servicePatterns: [
      'contractor medical clearance',
      'deployment medical examinations',
      'annual medical readiness evaluations',
      'international provider coordination',
    ],
    notes: 'Distributed federal-contractor medical-readiness programs are comparable.',
  },
  {
    client: 'CACI',
    aliases: [],
    program: 'SOCS and deployed-personnel support',
    evidenceType: 'active-client-program',
    servicePatterns: [
      'pre-deployment physical examinations',
      'medical clearance',
      'occupational testing',
      'deployment documentation review',
    ],
    notes: 'Security, intelligence, logistics, and expeditionary support contracts can create relevant medical-evaluation requirements.',
  },
  {
    client: 'Constellis',
    aliases: ['Triple Canopy'],
    program: 'Worldwide Protective Services workforce support',
    evidenceType: 'active-client-program',
    servicePatterns: [
      'security-contractor medical clearance',
      'fitness-for-duty evaluations',
      'deployment medical readiness',
      'drug and alcohol testing',
    ],
    notes: 'Armed-security and protective-services workforce health requirements are comparable.',
  },
  {
    client: 'IDS International',
    aliases: [],
    program: 'International periodic and deployment evaluations',
    evidenceType: 'documented-service-pattern',
    servicePatterns: [
      'overseas employee medical examinations',
      'periodic occupational health evaluations',
      'international clinic coordination',
      'results and document quality review',
    ],
    notes: 'Small or remote international employee populations remain viable because Occu-Med coordinates local providers.',
  },
  {
    client: 'GardaWorld Federal Services',
    aliases: ['Garda-Fed'],
    program: 'Security-contractor mobilization support',
    evidenceType: 'active-client-program',
    servicePatterns: [
      'mobilization medical examinations',
      'pre-deployment screening',
      'fitness-for-duty',
      'medical readiness documentation',
    ],
    notes: 'Mobilization-center and security-contractor medical programs are comparable.',
  },
  {
    client: 'Leidos and ManTech',
    aliases: ['Leidos', 'ManTech'],
    program: 'Federal-contractor deployment and readiness support',
    evidenceType: 'documented-service-pattern',
    servicePatterns: [
      'contractor medical clearance',
      'pre-deployment evaluations',
      'periodic medical examinations',
      'distributed provider network coordination',
    ],
    notes: 'Federal mission-support contracts with medical-clearance obligations are comparable.',
  },
]

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface OccuMedHistoricalMatch {
  client: string
  program: string
  matchedPatterns: string[]
  notes: string
}

export function matchOccuMedHistoricalPatterns(text: string): OccuMedHistoricalMatch[] {
  const normalized = normalize(text)
  if (!normalized) return []

  return OCCUMED_HISTORICAL_PURSUIT_SEEDS.flatMap(seed => {
    const matchedPatterns = seed.servicePatterns.filter(pattern => normalized.includes(normalize(pattern)))
    const clientMatch = [seed.client, ...seed.aliases]
      .map(normalize)
      .some(alias => alias.length >= 3 && normalized.includes(alias))

    if (matchedPatterns.length === 0 && !clientMatch) return []
    return [{
      client: seed.client,
      program: seed.program,
      matchedPatterns,
      notes: seed.notes,
    }]
  })
}
