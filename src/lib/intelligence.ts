export type SearchLens = 'web' | 'pdf' | 'government' | 'procurement' | 'pricing' | 'provider' | 'technical' | 'news'

export interface Signal {
  name: string
  score: number
  description: string
}

export interface IntelligenceObject {
  query: string
  lens: SearchLens
  summary?: string
  confidence: number
  signals: Signal[]
  sources: string[]
  queryExpansions: string[]
  timestamp: string
  note?: string
}

// ─── VERTICAL CONFIGURATION ───

interface VerticalConfig {
  label: string
  description: string
  keywords: string[]
  synonymMap: Record<string, string[]>
  expansions: (query: string) => string[]
  siteOperators: string[]
  scoringRules: Array<{
    pattern: RegExp
    score: number
    name: string
  }>
}

const LENS_CONFIGS: Record<SearchLens, VerticalConfig> = {
  web: {
    label: 'WEB',
    description: 'Broad-spectrum web search',
    keywords: [],
    synonymMap: {},
    expansions: (q) => [
      `${q} information`,
      `${q} about`,
      `${q} services`,
      `${q} overview`,
    ],
    siteOperators: [],
    scoringRules: [
      { pattern: /about|information|overview/i, score: 10, name: 'general info' },
    ],
  },

  pdf: {
    label: 'PDF',
    description: 'Find PDF documents and files',
    keywords: ['pdf', 'document', 'file', 'report', 'guide', 'manual'],
    synonymMap: {
      pdf: ['document', 'file', 'report', 'guide', 'manual', 'whitepaper'],
    },
    expansions: (q) => [
      `filetype:pdf ${q}`,
      `${q} pdf`,
      `${q} document`,
      `${q} report`,
      `${q} guide`,
    ],
    siteOperators: ['filetype:pdf'],
    scoringRules: [
      { pattern: /filetype:pdf|\.pdf/i, score: 40, name: 'PDF document' },
      { pattern: /document|report|guide|manual/i, score: 20, name: 'document language' },
    ],
  },

  government: {
    label: 'GOVERNMENT',
    description: 'Find government sources and official documents',
    keywords: ['government', 'official', 'federal', 'state', 'agency', 'department'],
    synonymMap: {
      government: ['federal', 'state', 'official', 'agency', 'department', 'authority'],
    },
    expansions: (q) => [
      `site:.gov ${q}`,
      `${q} government`,
      `${q} official`,
      `${q} agency`,
    ],
    siteOperators: ['site:.gov'],
    scoringRules: [
      { pattern: /\.gov\b/i, score: 35, name: '.gov domain' },
      { pattern: /government|official|federal|state agency/i, score: 30, name: 'government source' },
    ],
  },

  procurement: {
    label: 'PROCUREMENT INTEL',
    description: 'Find RFPs, bids, solicitations, and government contracts',
    keywords: ['RFP', 'bid', 'solicitation', 'procurement', 'tender', 'contract', 'proposal', 'RFQ', 'RFT'],
    synonymMap: {
      RFP: ['request for proposal', 'solicitation', 'bid', 'tender', 'procurement', 'RFQ', 'RFT', 'request for qualifications'],
      'occupational health': ['occupational medicine', 'worksite clinic', 'employee health', 'industrial medicine', 'pre-employment', 'employer clinic'],
      services: ['contract', 'agreement', 'engagement', 'arrangement', 'professional services'],
      open: ['active', 'current', 'accepting proposals', 'bid opportunity', 'vendor opportunity'],
    },
    expansions: (q) => {
      const baseExpansions = [
        `${q} RFP`,
        `${q} solicitation`,
        `${q} bid`,
        `${q} procurement`,
        `${q} contract opportunity`,
        `${q} vendor opportunity`,
        `${q} professional services agreement`,
        `${q} competitive sealed proposal`,
      ];
      
      const siteExpansions = [
        `site:.gov ${q}`,
        `site:sam.gov ${q}`,
        `site:ionwave.net ${q}`,
        `site:bonfirehub.com ${q}`,
        `site:bidnetdirect.com ${q}`,
        `site:planetbids.com ${q}`,
      ];
      
      const pdfExpansions = [
        `filetype:pdf ${q}`,
        `${q} filetype:pdf`,
      ];
      
      const active2026Expansions = [
        `${q} 2026 open`,
        `${q} 2026 active`,
        `${q} 2026 solicitation currently open`,
        `${q} bid opportunity 2026`,
        `${q} due date 2026`,
        `${q} responses due 2026`,
        `${q} closing date 2026`,
      ];
      
      const hiddenGoldmine = [
        `${q} notice inviting bids`,
        `${q} request for qualifications`,
        `${q} procurement opportunity`,
        `${q} current opportunities`,
      ];
      
      return [...baseExpansions, ...siteExpansions, ...pdfExpansions, ...active2026Expansions, ...hiddenGoldmine];
    },
    siteOperators: ['site:.gov', 'site:sam.gov', 'site:ionwave.net', 'site:bonfirehub.com', 'site:planetbids.com', 'site:bidnetdirect.com'],
    scoringRules: [
      { pattern: /\.gov\b/i, score: 35, name: '.gov domain' },
      { pattern: /RFP|solicitation|bid|tender|procurement|RFQ|RFT/i, score: 40, name: 'procurement language' },
      { pattern: /due date|deadline|closing date|responses due|submission deadline/i, score: 25, name: 'includes deadline' },
      { pattern: /open|active|current|accepting proposals|bid opportunity/i, score: 30, name: 'active opportunity' },
      { pattern: /filetype:pdf|\.pdf/i, score: 40, name: 'PDF document' },
      { pattern: /\$[\d,]+(?:\.\d{2})?|\$\d+ million|\$\d+K/i, score: 15, name: 'monetary value' },
      { pattern: /SAM\.gov|bonfire|planetbids|ionwave|bidnet/i, score: 30, name: 'procurement portal' },
      { pattern: /notice inviting bids|request for qualifications|competitive sealed proposal/i, score: 35, name: 'hidden goldmine terms' },
      { pattern: /2026/i, score: 20, name: '2026 active' },
    ],
  },

  technical: {
    label: 'TECHNICAL',
    description: 'Find technical documentation, code, and developer resources',
    keywords: ['api', 'documentation', 'code', 'developer', 'github', 'stack overflow', 'programming'],
    synonymMap: {
      api: ['interface', 'endpoint', 'rest', 'graphql', 'sdk'],
      documentation: ['docs', 'guide', 'reference', 'manual', 'tutorial'],
      code: ['source', 'repository', 'repo', 'programming', 'development'],
    },
    expansions: (q) => [
      `${q} api documentation`,
      `${q} developer guide`,
      `site:github.com ${q}`,
      `site:stackoverflow.com ${q}`,
      `${q} tutorial`,
      `${q} code example`,
    ],
    siteOperators: ['site:github.com', 'site:stackoverflow.com', 'site:devdocs.io'],
    scoringRules: [
      { pattern: /github\.com/i, score: 30, name: 'GitHub source' },
      { pattern: /stackoverflow\.com/i, score: 25, name: 'Stack Overflow' },
      { pattern: /api|documentation|docs/i, score: 30, name: 'technical docs' },
      { pattern: /code|programming|developer/i, score: 25, name: 'developer content' },
    ],
  },

  news: {
    label: 'NEWS',
    description: 'Find recent news articles and press coverage',
    keywords: ['news', 'press', 'article', 'report', 'breaking', 'coverage'],
    synonymMap: {
      news: ['press', 'article', 'report', 'coverage', 'breaking'],
    },
    expansions: (q) => [
      `${q} news`,
      `${q} press release`,
      `${q} article`,
      `${q} coverage`,
      `${q} latest`,
    ],
    siteOperators: [],
    scoringRules: [
      { pattern: /news|press|article|coverage/i, score: 30, name: 'news content' },
      { pattern: /breaking|latest|recent/i, score: 20, name: 'recent content' },
    ],
  },

  pricing: {
    label: 'PRICING INTEL',
    description: 'Extract fee schedules, rates, and cost structures',
    keywords: ['price', 'cost', 'fee', 'rate', 'schedule', 'pricing', 'charge', 'cash pay', 'self pay'],
    synonymMap: {
      pricing: ['fee schedule', 'cost', 'rates', 'charges', 'fees', 'price list', 'rate card', 'chargemaster'],
      'occupational health': ['occupational medicine', 'worksite clinic', 'employee health', 'industrial medicine', 'pre-employment', 'employer clinic'],
      'PFT': ['spirometry', 'pulmonary function test', 'breathing test', 'lung function'],
      'DOT': ['department of transportation', 'DOT physical', 'DOT exam', 'CDL physical'],
      physical: ['exam', 'screening', 'medical exam', 'health screening', 'pre-employment physical'],
      PDF: ['document', 'fee schedule', 'price list', 'rate sheet', 'transparency file'],
      occupational: ['worksite', 'industrial', 'employee', 'corporate', 'employer'],
    },
    expansions: (q) => {
      const baseExpansions = [
        `${q} fee schedule`,
        `${q} pricing`,
        `${q} cost`,
        `${q} rates`,
        `${q} price list`,
        `${q} fee structure`,
        `${q} chargemaster`,
      ];
      
      const pdfExpansions = [
        `filetype:pdf ${q}`,
        `${q} filetype:pdf`,
        `${q} transparency file`,
      ];
      
      const paymentTypeExpansions = [
        `${q} self-pay pricing`,
        `${q} cash pay`,
        `${q} out-of-pocket cost`,
        `${q} employer account`,
        `${q} work comp`,
        `${q} workers compensation`,
      ];
      
      const providerExpansions = [
        `${q} clinic`,
        `${q} provider`,
        `${q} urgent care`,
        `${q} occupational medicine`,
      ];
      
      return [...baseExpansions, ...pdfExpansions, ...paymentTypeExpansions, ...providerExpansions];
    },
    siteOperators: ['filetype:pdf'],
    scoringRules: [
      { pattern: /fee schedule|price list|rate card|fee structure|chargemaster/i, score: 40, name: 'pricing document' },
      { pattern: /filetype:pdf|\.pdf/i, score: 40, name: 'PDF document' },
      { pattern: /\$[\d,]+(?:\.\d{2})?|\$\d+\s*(million|k|K)?/i, score: 25, name: 'price values' },
      { pattern: /self-pay|cash price|out-of-pocket|cash pay/i, score: 30, name: 'self-pay mention' },
      { pattern: /employer account|work comp|workers compensation/i, score: 25, name: 'employer payment' },
      { pattern: /spirometry|pulmonary function|PFT/i, score: 20, name: 'PFT pricing' },
      { pattern: /DOT physical|CDL physical|department of transportation/i, score: 20, name: 'DOT pricing' },
    ],
  },

  provider: {
    label: 'PROVIDER INTEL',
    description: 'Find occupational health clinics, providers, and services',
    keywords: ['clinic', 'provider', 'doctor', 'physician', 'healthcare', 'medical', 'practice', 'occupational health', 'occupational medicine'],
    synonymMap: {
      clinic: ['medical center', 'health center', 'practice', 'facility', 'office', 'urgent care'],
      provider: ['doctor', 'physician', 'practitioner', 'specialist', 'clinician', 'medical group'],
      'occupational health': ['occupational medicine', 'worksite clinic', 'employee health', 'industrial medicine', 'pre-employment', 'employer clinic'],
      services: ['exams', 'screenings', 'physicals', 'testing', 'drug testing', 'DOT physical', 'PFT'],
    },
    expansions: (q) => {
      const baseExpansions = [
        `${q} clinic`,
        `${q} provider directory`,
        `${q} medical practice`,
        `${q} healthcare provider`,
        `${q} physician`,
        `${q} services offered`,
        `${q} locations`,
      ];
      
      const serviceExpansions = [
        `${q} occupational health services`,
        `${q} DOT physical`,
        `${q} drug testing`,
        `${q} pre-employment physical`,
        `${q} pulmonary function test`,
        `${q} audiometry`,
        `${q} respirator fit test`,
      ];
      
      const locationExpansions = [
        `${q} near me`,
        `${q} locations`,
        `${q} directory`,
        `${q} clinic locations`,
      ];
      
      return [...baseExpansions, ...serviceExpansions, ...locationExpansions];
    },
    siteOperators: [],
    scoringRules: [
      { pattern: /clinic|medical center|health center|practice|facility/i, score: 30, name: 'provider entity' },
      { pattern: /physician|doctor|provider|clinician|medical group/i, score: 25, name: 'provider keywords' },
      { pattern: /board certified|licensed|accredited/i, score: 20, name: 'credentials' },
      { pattern: /location|address|suite|floor/i, score: 15, name: 'physical address' },
      { pattern: /occupational health|occupational medicine|worksite clinic/i, score: 35, name: 'occupational health provider' },
      { pattern: /DOT physical|drug testing|pre-employment|PFT/i, score: 30, name: 'occupational services' },
    ],
  },

}

// ─── CLASSIFY VERTICAL ───

export function classifyLens(query: string): SearchLens {
  const q = query.toLowerCase()
  const scores: Record<SearchLens, number> = {
    web: 1,
    pdf: 0,
    government: 0,
    procurement: 0,
    pricing: 0,
    provider: 0,
    technical: 0,
    news: 0,
  }

  for (const [lens, config] of Object.entries(LENS_CONFIGS)) {
    if (lens === 'web') continue
    for (const kw of config.keywords) {
      if (q.includes(kw.toLowerCase())) {
        scores[lens as SearchLens] += 2
      }
    }
  }

  // Special weighting
  if (/\b(rfp|rfq|tender|solicitation|procurement|bid)\b/i.test(q)) scores.procurement += 5
  if (/\b(price|cost|fee|rate|pricing|schedule)\b/i.test(q)) scores.pricing += 5
  if (/\b(clinic|provider|doctor|physician|occupational health|occupational medicine)\b/i.test(q)) scores.provider += 5
  if (/\b(pdf|document|file|report|guide|manual)\b/i.test(q)) scores.pdf += 3
  if (/\b(government|official|federal|state|agency)\b/i.test(q)) scores.government += 4
  if (/\b(api|documentation|code|developer|github|programming)\b/i.test(q)) scores.technical += 4
  if (/\b(news|press|article|coverage|breaking)\b/i.test(q)) scores.news += 4

  let best: SearchLens = 'web'
  let bestScore = 0
  for (const [lens, s] of Object.entries(scores)) {
    if (s > bestScore) {
      bestScore = s
      best = lens as SearchLens
    }
  }

  return best
}

// ─── QUERY EXPANSION ───

export interface ExpandedQuery {
  original: string
  lens: SearchLens
  expansions: string[]
  withOperators: string[]
  synonyms: Record<string, string[]>
}

export function expandQuery(query: string, forcedLens?: SearchLens): ExpandedQuery {
  const lens = forcedLens || classifyLens(query)
  const config = LENS_CONFIGS[lens]

  // Build synonym map for this specific query
  const synonyms: Record<string, string[]> = {}
  for (const [key, variants] of Object.entries(config.synonymMap)) {
    if (query.toLowerCase().includes(key.toLowerCase())) {
      synonyms[key] = variants
    }
  }

  // Generate expansions
  const expansions = config.expansions(query)

  // Inject site operators into a subset of expansions
  const withOperators: string[] = []
  if (config.siteOperators.length > 0) {
    for (const op of config.siteOperators) {
      withOperators.push(`${op} "${query}"`)
    }
  }

  // Add synonym-swapped variants
  const synonymVariants: string[] = []
  for (const [key, variants] of Object.entries(synonyms)) {
    for (const variant of variants) {
      const swapped = query.replace(new RegExp(key, 'gi'), variant)
      if (swapped !== query) {
        synonymVariants.push(swapped)
      }
    }
  }

  return {
    original: query,
    lens,
    expansions: [...new Set([...expansions, ...synonymVariants])],
    withOperators: [...new Set(withOperators)],
    synonyms,
  }
}

// ─── SIGNAL SCORING ───

export function scoreSignals(text: string, url?: string): Signal[] {
  const signals: Signal[] = []
  const allText = `${text} ${url || ''}`.toLowerCase()

  // Domain authority signals
  if (/\.gov\b/.test(url || '')) {
    signals.push({ name: '.gov domain', score: 35, description: 'Government domain = high authority' })
  }
  if (/\.edu\b/.test(url || '')) {
    signals.push({ name: '.edu domain', score: 30, description: 'Educational institution' })
  }
  if (/\.org\b/.test(url || '')) {
    signals.push({ name: '.org domain', score: 15, description: 'Non-profit organization' })
  }

  // Procurement portal signals
  if (/sam\.gov|bonfire|planetbids|ionwave|bidnet/i.test(url || '')) {
    signals.push({ name: 'procurement portal', score: 30, description: 'Official procurement platform' })
  }

  // Content signals - Procurement
  if (/RFP|solicitation|bid|tender|procurement|RFQ|RFT/i.test(text)) {
    signals.push({ name: 'procurement language', score: 40, description: 'Contains procurement terminology' })
  }
  if (/filetype:pdf|\.pdf/i.test(text)) {
    signals.push({ name: 'PDF document', score: 40, description: 'PDF RFP document' })
  }
  if (/due date|deadline|closing date|responses due|submission deadline/i.test(text)) {
    signals.push({ name: 'includes deadline', score: 25, description: 'Contains deadline information' })
  }
  if (/open|active|current|accepting proposals|bid opportunity/i.test(text)) {
    signals.push({ name: 'active opportunity', score: 30, description: 'Currently accepting bids' })
  }
  if (/notice inviting bids|request for qualifications|competitive sealed proposal/i.test(text)) {
    signals.push({ name: 'hidden goldmine terms', score: 35, description: 'Alternative procurement terminology' })
  }
  if (/2026/i.test(text)) {
    signals.push({ name: '2026 active', score: 20, description: 'Current year opportunity' })
  }

  // Content signals - Pricing
  if (/fee schedule|price list|rate card|fee structure|chargemaster/i.test(text)) {
    signals.push({ name: 'pricing document', score: 40, description: 'Explicit pricing terminology' })
  }
  if (/\$[\d,]+(?:\.\d{2})?|\$\d+\s*(million|k|K)?/i.test(text)) {
    signals.push({ name: 'monetary values', score: 25, description: 'Contains dollar amounts' })
  }
  if (/self-pay|cash price|out-of-pocket|cash pay/i.test(text)) {
    signals.push({ name: 'self-pay mention', score: 30, description: 'Self-pay pricing available' })
  }
  if (/employer account|work comp|workers compensation/i.test(text)) {
    signals.push({ name: 'employer payment', score: 25, description: 'Employer billing options' })
  }

  // Content signals - Occupational Health
  if (/occupational health|occupational medicine|worksite clinic|employee health/i.test(text)) {
    signals.push({ name: 'occupational health match', score: 25, description: 'Exact service match' })
  }
  if (/DOT physical|CDL physical|department of transportation/i.test(text)) {
    signals.push({ name: 'DOT physical', score: 20, description: 'DOT exam services' })
  }
  if (/spirometry|pulmonary function|PFT/i.test(text)) {
    signals.push({ name: 'PFT pricing', score: 20, description: 'Pulmonary function testing' })
  }
  if (/drug testing|pre-employment physical|audiometry|respirator fit test/i.test(text)) {
    signals.push({ name: 'occupational services', score: 25, description: 'Specific occupational health services' })
  }

  // Content signals - Provider
  if (/clinic|medical center|health center|practice|facility/i.test(text)) {
    signals.push({ name: 'provider entity', score: 30, description: 'Healthcare facility' })
  }
  if (/physician|doctor|provider|clinician|medical group/i.test(text)) {
    signals.push({ name: 'provider keywords', score: 25, description: 'Medical provider' })
  }
  if (/board certified|licensed|accredited/i.test(text)) {
    signals.push({ name: 'credentials', score: 20, description: 'Professional credentials mentioned' })
  }
  if (/location|address|suite|floor/i.test(text)) {
    signals.push({ name: 'physical address', score: 15, description: 'Contains location information' })
  }

  // Negative signals
  if (/spam|scam|fake|unverified/i.test(text)) {
    signals.push({ name: 'suspicious content', score: -40, description: 'Potential spam or fraud indicators' })
  }
  if (/archive\.org|wayback|cached/i.test(url || '')) {
    signals.push({ name: 'archived page', score: -25, description: 'Potentially outdated content' })
  }
  if (/directory|list|index|catalog/i.test(url || '')) {
    signals.push({ name: 'junk directory', score: -20, description: 'Generic directory page' })
  }
  if (/404|not found|error|unavailable/i.test(text)) {
    signals.push({ name: 'page error', score: -30, description: 'Page access issues' })
  }

  return signals
}

export function calculateConfidence(signals: Signal[]): number {
  const totalScore = signals.reduce((sum, s) => sum + s.score, 0)
  const raw = Math.min(totalScore + 40, 100)
  return Math.max(0, Math.round(raw))
}

// ─── INTELLIGENCE OBJECT BUILDER ───

export function buildIntelligenceObject(
  query: string,
  expanded: ExpandedQuery,
  rawSources: string[],
  rawTexts: string[],
  note?: string
): IntelligenceObject {
  const allSignals: Signal[] = []

  // Score each raw text snippet
  for (const text of rawTexts) {
    const sigs = scoreSignals(text)
    for (const s of sigs) {
      // deduplicate by name
      if (!allSignals.find((x) => x.name === s.name)) {
        allSignals.push(s)
      }
    }
  }

  const confidence = calculateConfidence(allSignals)

  // Generate a summary based on signals and lens
  const summary = generateSummary(query, expanded.lens, allSignals)

  return {
    query,
    lens: expanded.lens,
    summary,
    confidence,
    signals: allSignals,
    sources: [...new Set(rawSources)],
    queryExpansions: expanded.expansions,
    timestamp: new Date().toISOString(),
    note,
  }
}

function generateSummary(query: string, lens: SearchLens, signals: Signal[]): string {
  const signalNames = signals.filter(s => s.score > 0).map(s => s.name).slice(0, 3)
  const signalText = signalNames.length > 0 ? signalNames.join(', ') : 'general content'
  return `Results for "${query}" using ${lens} lens. Detected: ${signalText}. Found ${signals.length} relevance signals.`
}

export { LENS_CONFIGS }
