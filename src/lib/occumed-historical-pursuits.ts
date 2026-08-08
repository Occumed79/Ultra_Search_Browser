export type OccuMedHistoricalEvidenceType =
  | 'verified-prime-award'
  | 'verified-subcontract-award'
  | 'verified-performance-record'
  | 'active-client-program'
  | 'documented-service-pattern'

export interface OccuMedHistoricalPursuitSeed {
  client: string
  aliases: string[]
  program: string
  evidenceType: OccuMedHistoricalEvidenceType
  servicePatterns: string[]
  notes: string
  awardId?: string
  buyer?: string
  awardDate?: string
  publicEvidenceUrl?: string
  confidence?: 'verified-high' | 'contextual'
}

/**
 * Public award/performance evidence is intentionally historical context only.
 * These records teach Ultra Search what Occu-Med has actually won or performed;
 * an award notice, expired solicitation, or historical contract is NEVER a live
 * opportunity and remains subject to the normal lifecycle gate.
 */
export const OCCUMED_VERIFIED_AWARD_SEEDS: OccuMedHistoricalPursuitSeed[] = [
  {
    client: 'U.S. Department of Transportation',
    aliases: ['DOT', 'Office of the Secretary of Transportation', 'Protective Service Division'],
    program: 'Protective Service Division medical examinations and fitness determinations',
    evidenceType: 'verified-prime-award',
    awardId: '693JK426C600013',
    buyer: 'U.S. Department of Transportation, Office of the Secretary',
    awardDate: '2026-07-01',
    publicEvidenceUrl: 'https://govtribe.com/award/federal-contract-award/definitive-contract-693jk426c600013',
    confidence: 'verified-high',
    servicePatterns: [
      'occupational medical examination',
      'medical examinations and fitness determinations',
      'pre-employment exams',
      'periodic employee exams',
      'return-to-duty reviews',
      'fitness-for-duty evaluations',
      'vision and hearing testing',
      'laboratory work',
      'ekg',
      'spirometry',
      'nationwide medical exam locations',
    ],
    notes: 'A 2026 prime award proves direct fit for law-enforcement/public-safety occupational exams, fitness determinations, ancillary testing, and nationwide exam coordination.',
  },
  {
    client: 'Massachusetts Army National Guard',
    aliases: ['MA ARNG', 'Massachusetts National Guard'],
    program: 'Occupational Health Exams at Hanscom AFB',
    evidenceType: 'verified-prime-award',
    awardId: 'W912SV24P0013',
    buyer: 'Massachusetts Army National Guard',
    awardDate: '2024-08-20',
    publicEvidenceUrl: 'https://www.highergov.com/contract/W912SV24P0013/',
    confidence: 'verified-high',
    servicePatterns: [
      'occupational health exams',
      'job-related medical examinations',
      'medical surveillance',
      'fitness for duty evaluations',
      'termination exams',
      'audiology consultations',
    ],
    notes: 'Repeat Army National Guard business confirms job-related occupational exams and surveillance as core award language.',
  },
  {
    client: 'Kansas Army National Guard',
    aliases: ['KS ARNG', 'Kansas National Guard'],
    program: 'Job-related occupational health medical examinations',
    evidenceType: 'verified-prime-award',
    awardId: 'W912JC24A0004',
    buyer: 'Kansas Army National Guard',
    awardDate: '2024-03-29',
    publicEvidenceUrl: 'https://govtribe.com/vendors/occu-med-ltd-dot-4w7a0',
    confidence: 'verified-high',
    servicePatterns: [
      'job-related medical examinations',
      'periodic examinees',
      'new hire examinations',
      'exit examinations',
      'physical exams',
      'laboratory testing',
      'medical review and consultation',
    ],
    notes: 'The BPA covers recurring periodic, new-hire, and exit examinations plus labs and medical review.',
  },
  {
    client: 'U.S. Army Corps of Engineers Nashville District',
    aliases: ['USACE Nashville', 'Army Corps of Engineers Nashville'],
    program: 'Medical surveillance for operations employees across 18 locations',
    evidenceType: 'verified-prime-award',
    awardId: 'W912P523D0011',
    buyer: 'U.S. Army Corps of Engineers, Nashville District',
    awardDate: '2023-06-12',
    publicEvidenceUrl: 'https://www.federalcompass.com/fed-contract-award/W912P523D0011',
    confidence: 'verified-high',
    servicePatterns: [
      'medical surveillance services',
      'medical surveillance for operations employees',
      'physical exams',
      'occupational health testing',
      'medical surveillance reporting',
      'multiple locations',
    ],
    notes: 'A multi-location USACE IDC is strong evidence for distributed medical-surveillance programs rather than one-clinic-only work.',
  },
  {
    client: 'U.S. Army',
    aliases: ['Department of the Army'],
    program: 'Occupational health medical surveillance exams and lab services',
    evidenceType: 'verified-prime-award',
    awardId: 'W9136423A0004',
    buyer: 'U.S. Department of the Army',
    awardDate: '2023-08-08',
    publicEvidenceUrl: 'https://www.federalcompass.com/award-contract-detail/W9136423A0004',
    confidence: 'verified-high',
    servicePatterns: [
      'occupational health medical surveillance exams',
      'medical surveillance exams',
      'lab services',
      'clinical exams',
      'medical testing',
    ],
    notes: 'This BPA directly validates occupational medical surveillance plus associated laboratory services.',
  },
  {
    client: 'Cybersecurity and Infrastructure Security Agency',
    aliases: ['CISA', 'DHS CISA'],
    program: 'Medical Surveillance Support',
    evidenceType: 'verified-prime-award',
    awardId: '70RCSA22C00000011',
    buyer: 'Cybersecurity and Infrastructure Security Agency',
    awardDate: '2022-09-30',
    publicEvidenceUrl: 'https://www.highergov.com/contract-forecast/medical-surveillance-support-1119552/',
    confidence: 'verified-high',
    servicePatterns: [
      'medical surveillance support',
      'pre-placement physical exams',
      'periodic physical exams',
      'exit physical exams',
      'return to work exams',
      'fit for duty exams',
      'record and case review',
    ],
    notes: 'CISA identified Occu-Med as the incumbent for a follow-on covering pre-placement, periodic, exit, return-to-work, fit-for-duty, and case review.',
  },
  {
    client: 'U.S. Army Corps of Engineers Seattle District',
    aliases: ['USACE Seattle', 'Army Corps of Engineers Seattle'],
    program: 'Libby Dam Medical Surveillance Services',
    evidenceType: 'verified-prime-award',
    awardId: 'W912DW21D1009',
    buyer: 'U.S. Army Corps of Engineers, Seattle District',
    awardDate: '2021-04-01',
    publicEvidenceUrl: 'https://govtribe.com/award/federal-idv-award/indefinite-delivery-contract-w912dw21d1009',
    confidence: 'verified-high',
    servicePatterns: [
      'medical surveillance services',
      'medical testing services',
      'medical monitoring and screening',
      'occupational health services',
    ],
    notes: 'USACE awarded Occu-Med recurring medical-surveillance/testing work for the Libby Dam workforce.',
  },
  {
    client: 'U.S. Army Corps of Engineers Seattle District',
    aliases: ['USACE Seattle', 'Army Corps of Engineers Seattle'],
    program: 'Albeni Falls Dam Medical Surveillance Services',
    evidenceType: 'verified-prime-award',
    awardId: 'W912DW21D1010',
    buyer: 'U.S. Army Corps of Engineers, Seattle District',
    awardDate: '2021-04-14',
    publicEvidenceUrl: 'https://www.federalcompass.com/award-contract-detail/W912DW21D1010',
    confidence: 'verified-high',
    servicePatterns: [
      'medical surveillance testing services',
      'laboratory diagnostics',
      'cancer screening',
      'audiometry',
      'spirometry testing',
    ],
    notes: 'Delivery-order evidence explicitly includes labs, cancer screening, audiometry, and spirometry.',
  },
  {
    client: 'U.S. Army Corps of Engineers Seattle District',
    aliases: ['USACE Seattle', 'Army Corps of Engineers Seattle'],
    program: 'Lake Washington Ship Canal Medical Testing Services',
    evidenceType: 'verified-prime-award',
    awardId: 'W912DW21D1000',
    buyer: 'U.S. Army Corps of Engineers, Seattle District',
    awardDate: '2021-03-30',
    publicEvidenceUrl: 'https://www.federalcompass.com/fed-contract-award/W912DW21D1000',
    confidence: 'verified-high',
    servicePatterns: [
      'medical testing services',
      'occupational medical testing',
      'medical surveillance testing',
    ],
    notes: 'Another USACE Seattle IDIQ demonstrates repeat buying of recurring workforce medical testing.',
  },
  {
    client: 'Wisconsin Army National Guard',
    aliases: ['WI ARNG', 'Wisconsin National Guard'],
    program: 'Statewide occupational health exam services',
    evidenceType: 'verified-prime-award',
    awardId: 'W912J220D0004',
    buyer: 'Wisconsin Army National Guard',
    awardDate: '2020-08-23',
    publicEvidenceUrl: 'https://www.federalcompass.com/fed-contract-award/W912J220D0004',
    confidence: 'verified-high',
    servicePatterns: [
      'occupational health exam services',
      'occupational health exams',
      'clinics throughout the state',
      'medical exams',
      'testing monitoring and reporting',
    ],
    notes: 'The statewide clinic model is direct evidence that distributed clinic delivery is a proven Occu-Med contract model.',
  },
  {
    client: 'Massachusetts Army National Guard',
    aliases: ['MA ARNG', 'Massachusetts National Guard'],
    program: 'Occupational Health Exams',
    evidenceType: 'verified-prime-award',
    awardId: 'W912SV19P0022',
    buyer: 'Massachusetts Army National Guard',
    awardDate: '2019-08-20',
    publicEvidenceUrl: 'https://www.federalcompass.com/award-contract-detail/W912SV19P0022',
    confidence: 'verified-high',
    servicePatterns: [
      'occupational health exams',
      'medical exams',
      'occupational testing',
      'health monitoring',
      'medical reporting',
    ],
    notes: 'The 2019 award plus the 2024 follow-on pattern establishes repeat National Guard demand.',
  },
  {
    client: 'U.S. Forest Service',
    aliases: ['USDA Forest Service', 'Sierra National Forest'],
    program: 'Sierra National Forest firefighter medical service exams',
    evidenceType: 'verified-prime-award',
    awardId: '129JGP18A0014',
    buyer: 'U.S. Forest Service, Sierra National Forest',
    awardDate: '2018-05-01',
    publicEvidenceUrl: 'https://www.federalcompass.com/award-contract-detail/129JGP18A0014',
    confidence: 'verified-high',
    servicePatterns: [
      'firefighter medical service exams',
      'firefighter medical exams',
      'medical service exam',
      'public safety medical evaluations',
    ],
    notes: 'Firefighter medical examinations are not hypothetical fit; they are documented prime-award work.',
  },
  {
    client: 'Western Area Power Administration',
    aliases: ['WAPA', 'Department of Energy'],
    program: 'Annual physical examinations for Redding employees',
    evidenceType: 'verified-prime-award',
    awardId: '89503321PWA000145',
    buyer: 'Western Area Power Administration',
    awardDate: '2020-12-17',
    publicEvidenceUrl: 'https://govtribe.com/vendors/occu-med-ltd-dot-4w7a0',
    confidence: 'verified-high',
    servicePatterns: [
      'annual physical examinations',
      'employee physical examinations',
      'periodic medical examinations',
      'utility workforce medical exams',
    ],
    notes: 'A civilian energy/utility buyer expands the proven pattern beyond defense organizations.',
  },
  {
    client: 'County of El Dorado',
    aliases: ['El Dorado County'],
    program: 'Professional Occupational Health Consulting Services',
    evidenceType: 'verified-prime-award',
    awardId: 'RFP 24-0068',
    buyer: 'County of El Dorado, California',
    awardDate: '2024-09-10',
    publicEvidenceUrl: 'https://www.eldoradocounty.ca.gov/files/assets/county/v/1/documents/government/bids-amp-procurement/awards-for-fy-2023-2024/rfp-24-0068-noa-signed.pdf',
    confidence: 'verified-high',
    servicePatterns: [
      'professional occupational health consulting services',
      'occupational health consulting',
      'fitness for duty',
      'occupational health program',
    ],
    notes: 'Official county award notice names Occu-Med as the apparent successful proposer; El Dorado also documents an earlier Occu-Med occupational-health consulting agreement.',
  },
  {
    client: 'Solano County',
    aliases: ['County of Solano'],
    program: 'Occupational medicine and examination services',
    evidenceType: 'verified-prime-award',
    awardId: 'Solano County File 25-684',
    buyer: 'Solano County, California',
    awardDate: '2025-08-26',
    publicEvidenceUrl: 'https://solano.legistar.com/LegislationDetail.aspx?GUID=FA2401EB-6605-4033-97F9-C21C7C9D112F&ID=7523524&Options=&Search=',
    confidence: 'verified-high',
    servicePatterns: [
      'occupational medicine and examination services',
      'occupational medicine',
      'employee examinations',
      'fitness for duty',
    ],
    notes: 'County contract evidence confirms direct public-agency demand for occupational medicine and examination services.',
  },
  {
    client: 'City of Riverside',
    aliases: ['Riverside, California'],
    program: 'Pre-Employment Physicals and DOT DMV Medical Exams',
    evidenceType: 'verified-prime-award',
    awardId: 'RFP 2458',
    buyer: 'City of Riverside, California',
    awardDate: '2025-11-18',
    publicEvidenceUrl: 'https://riversideca.legistar.com/gateway.aspx?ID=30dec1d7-41b0-407f-a251-dd7318f114c2.docx&M=F',
    confidence: 'verified-high',
    servicePatterns: [
      'pre-employment physicals',
      'pre-employment medical examinations',
      'dot dmv medical exams',
      'dot physicals',
    ],
    notes: 'Official city council material approves Occu-Med for pre-employment physicals and DOT/DMV medical exams.',
  },
  {
    client: 'City of Costa Mesa',
    aliases: ['Costa Mesa, California'],
    program: 'Pre-employment medical examinations and evaluation services',
    evidenceType: 'verified-prime-award',
    awardId: 'Costa Mesa PSA 2020 + amendments',
    buyer: 'City of Costa Mesa, California',
    awardDate: '2020-11-18',
    publicEvidenceUrl: 'https://www.costamesaca.gov/home/showpublisheddocument/60261/638833566407500000',
    confidence: 'verified-high',
    servicePatterns: [
      'pre-employment medical examinations',
      'medical evaluation services',
      'pre-placement medical evaluations',
    ],
    notes: 'The agreement was repeatedly amended/extended, demonstrating durable municipal demand for pre-employment medical evaluation services.',
  },
  {
    client: 'Vectrus',
    aliases: ['V2X'],
    program: 'Kwajalein mass fit-for-duty screening',
    evidenceType: 'verified-performance-record',
    buyer: 'Vectrus / U.S. Army Garrison Kwajalein Atoll support',
    awardDate: '2022-10-05',
    publicEvidenceUrl: 'https://www.smdc.army.mil/Portals/38/Documents/Publications/Hourglass/2022/10-08-22Hourglass.pdf',
    confidence: 'verified-high',
    servicePatterns: [
      'fit-for-duty health screenings',
      'mass medical screening',
      'physical dental and optical health',
      'contractor workforce screening',
      'overseas workforce medical screening',
    ],
    notes: 'U.S. Army publication documents Occu-Med completing fit-for-duty screening for more than 1,000 Vectrus employees and subcontractors.',
  },
  {
    client: 'Defense prime contractors',
    aliases: ['LOGCAP', 'base operations support'],
    program: 'Fit-for-duty medical-services subcontracts',
    evidenceType: 'verified-subcontract-award',
    awardId: 'L5CPMP0339S / M4NDMP0045S',
    buyer: 'Defense-prime task orders under Army logistics/facilities vehicles',
    awardDate: '2024-12-04',
    publicEvidenceUrl: 'https://govtribe.com/vendors/occu-med-ltd-dot-4w7a0',
    confidence: 'verified-high',
    servicePatterns: [
      'fit for duty medical services',
      'fit-for-duty medical services',
      'deployed workforce medical services',
      'contractor medical evaluations',
    ],
    notes: 'Public federal subcontract records explicitly describe Occu-Med scopes as fit-for-duty medical services, which is useful similarity evidence for prime-contractor opportunities.',
  },
]

const OCCUMED_OPERATIONAL_CONTEXT_SEEDS: OccuMedHistoricalPursuitSeed[] = [
  {
    client: 'V2X',
    aliases: ['Vectrus'],
    program: 'LOGCAP V and AFCAP workforce support',
    evidenceType: 'active-client-program',
    confidence: 'contextual',
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
    confidence: 'contextual',
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
    confidence: 'contextual',
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
    confidence: 'contextual',
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
    confidence: 'contextual',
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
    confidence: 'contextual',
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
    confidence: 'contextual',
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
    confidence: 'contextual',
    servicePatterns: [
      'contractor medical clearance',
      'pre-deployment evaluations',
      'periodic medical examinations',
      'distributed provider network coordination',
    ],
    notes: 'Federal mission-support contracts with medical-clearance obligations are comparable.',
  },
]

export const OCCUMED_HISTORICAL_PURSUIT_SEEDS: OccuMedHistoricalPursuitSeed[] = [
  ...OCCUMED_VERIFIED_AWARD_SEEDS,
  ...OCCUMED_OPERATIONAL_CONTEXT_SEEDS,
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
  evidenceType: OccuMedHistoricalEvidenceType
  matchedPatterns: string[]
  notes: string
  awardId?: string
  buyer?: string
  publicEvidenceUrl?: string
  confidence?: 'verified-high' | 'contextual'
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
      evidenceType: seed.evidenceType,
      matchedPatterns,
      notes: seed.notes,
      awardId: seed.awardId,
      buyer: seed.buyer,
      publicEvidenceUrl: seed.publicEvidenceUrl,
      confidence: seed.confidence,
    }]
  })
}
