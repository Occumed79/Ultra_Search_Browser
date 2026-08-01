/**
 * Procurement / RFP local index — seed sources
 *
 * PUBLIC sources only (no vendor login to read listings/RSS).
 *
 * Types:
 *   - rss   → scripts/fetch-feeds.ts + POST /api/index/bootstrap
 *   - portal → future HTML list indexer
 *   - api   → free public API (e.g. SAM.gov key)
 *
 * Verified 2026-07-31:
 *   Federal Register API RSS works (200 + <item>s)
 *   Grants.gov RSS returns HTML challenge (disabled until fixed)
 *   GSA /rss/news.xml returns 404 (disabled)
 */

export type IndexSourceKind = 'rss' | 'portal' | 'api'

export type IndexCategory =
  | 'procurement'
  | 'government'
  | 'grants'
  | 'healthcare_procurement'

export interface ProcurementIndexSeed {
  id: string
  title: string
  url: string
  kind: IndexSourceKind
  category: IndexCategory
  jurisdiction: string
  notes?: string
  active: boolean
}

const FR = 'https://www.federalregister.gov/api/v1/documents.rss'

export const PROCUREMENT_RSS_SEEDS: ProcurementIndexSeed[] = [
  // ── Federal Register (verified working) ──
  {
    id: 'fr-notices',
    title: 'Federal Register — Notices',
    url: `${FR}?conditions%5Btype%5D%5B%5D=NOTICE`,
    kind: 'rss',
    category: 'government',
    jurisdiction: 'US Federal',
    notes: 'Verified: returns RSS items',
    active: true,
  },
  {
    id: 'fr-proposed-rules',
    title: 'Federal Register — Proposed Rules',
    url: `${FR}?conditions%5Btype%5D%5B%5D=PRORULE`,
    kind: 'rss',
    category: 'government',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-rules',
    title: 'Federal Register — Rules',
    url: `${FR}?conditions%5Btype%5D%5B%5D=RULE`,
    kind: 'rss',
    category: 'government',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-gsa',
    title: 'Federal Register — GSA',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=general-services-administration`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-hhs',
    title: 'Federal Register — HHS',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=health-and-human-services-department`,
    kind: 'rss',
    category: 'healthcare_procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-va',
    title: 'Federal Register — Veterans Affairs',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=veterans-affairs-department`,
    kind: 'rss',
    category: 'healthcare_procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-dod',
    title: 'Federal Register — Defense',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=defense-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-labor',
    title: 'Federal Register — Labor',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=labor-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    notes: 'Often includes workplace / occupational health related notices',
    active: true,
  },
  {
    id: 'fr-interior',
    title: 'Federal Register — Interior',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=interior-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-transportation',
    title: 'Federal Register — Transportation',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=transportation-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-homeland',
    title: 'Federal Register — Homeland Security',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=homeland-security-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-agriculture',
    title: 'Federal Register — Agriculture',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=agriculture-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-commerce',
    title: 'Federal Register — Commerce',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=commerce-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-energy',
    title: 'Federal Register — Energy',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=energy-department`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-epa',
    title: 'Federal Register — EPA',
    url: `${FR}?conditions%5Bagencies%5D%5B%5D=environmental-protection-agency`,
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },

  // ── Temporarily disabled (bot challenge / 404) ──
  {
    id: 'grants-gov-new-by-agency',
    title: 'Grants.gov — New Opportunities by Agency',
    url: 'https://www.grants.gov/rss/GG_NewOppByAgency.xml',
    kind: 'rss',
    category: 'grants',
    jurisdiction: 'US Federal',
    notes: 'Disabled: returns HTML challenge instead of RSS (2026-07-31)',
    active: false,
  },
  {
    id: 'grants-gov-new-by-category',
    title: 'Grants.gov — New Opportunities by Category',
    url: 'https://www.grants.gov/rss/GG_NewOppByCategory.xml',
    kind: 'rss',
    category: 'grants',
    jurisdiction: 'US Federal',
    notes: 'Disabled: HTML challenge',
    active: false,
  },
  {
    id: 'gsa-news',
    title: 'GSA Newsroom RSS',
    url: 'https://www.gsa.gov/rss/news.xml',
    kind: 'rss',
    category: 'government',
    jurisdiction: 'US Federal',
    notes: 'Disabled: HTTP 404',
    active: false,
  },
]

export const PROCUREMENT_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  {
    id: 'sam-gov-opportunities',
    title: 'SAM.gov Contract Opportunities',
    url: 'https://sam.gov/opportunities',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'US Federal',
    notes: 'Primary federal contract board',
    active: true,
  },
  {
    id: 'sam-gov-api',
    title: 'SAM.gov Get Opportunities Public API',
    url: 'https://api.sam.gov/opportunities/v2/search',
    kind: 'api',
    category: 'procurement',
    jurisdiction: 'US Federal',
    notes: 'Free public API key required for production indexer',
    active: true,
  },
  {
    id: 'usaspending',
    title: 'USAspending.gov',
    url: 'https://www.usaspending.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'ca-caleprocure',
    title: 'California — Cal eProcure',
    url: 'https://caleprocure.ca.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'California',
    active: true,
  },
  {
    id: 'tx-esbd',
    title: 'Texas — ESBD',
    url: 'https://www.txsmartbuy.com/esbd',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Texas',
    active: true,
  },
  {
    id: 'ny-nyscr',
    title: 'New York — Contract Reporter',
    url: 'https://www.nyscr.ny.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'New York',
    active: true,
  },
  {
    id: 'il-bidbuy',
    title: 'Illinois — BidBuy',
    url: 'https://www.bidbuy.illinois.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Illinois',
    active: true,
  },
  {
    id: 'fl-mfmp',
    title: 'Florida — MyFloridaMarketPlace',
    url: 'https://vendor.myfloridamarketplace.com/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Florida',
    active: true,
  },
  {
    id: 'wa-webs',
    title: 'Washington — WEBS',
    url: 'https://pr-webs-vendor.des.wa.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Washington',
    active: true,
  },
  {
    id: 'or-oregonbuys',
    title: 'Oregon — OregonBuys',
    url: 'https://oregonbuys.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Oregon',
    active: true,
  },
  {
    id: 'co-vss',
    title: 'Colorado — VSS',
    url: 'https://www.colorado.gov/vss',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Colorado',
    active: true,
  },
  {
    id: 'az-app',
    title: 'Arizona — APP',
    url: 'https://app.az.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Arizona',
    active: true,
  },
  {
    id: 'ga-team',
    title: 'Georgia — Team Georgia Marketplace',
    url: 'https://ssl.doas.state.ga.us/PRSapp/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Georgia',
    active: true,
  },
  {
    id: 'nc-ips',
    title: 'North Carolina — IPS',
    url: 'https://www.ips.state.nc.us/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'North Carolina',
    active: true,
  },
  {
    id: 'pa-emarket',
    title: 'Pennsylvania — eMarketplace',
    url: 'https://www.emarketplace.state.pa.us/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Pennsylvania',
    active: true,
  },
  {
    id: 'oh-procure',
    title: 'Ohio — OhioBuys',
    url: 'https://ohiobuys.ohio.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Ohio',
    active: true,
  },
  {
    id: 'mi-sigma',
    title: 'Michigan — SIGMA VSS',
    url: 'https://sigma.michigan.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Michigan',
    active: true,
  },
  {
    id: 'ma-commbuys',
    title: 'Massachusetts — COMMBUYS',
    url: 'https://www.commbuys.com/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Massachusetts',
    active: true,
  },
  {
    id: 'va-eva',
    title: 'Virginia — eVA',
    url: 'https://eva.virginia.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Virginia',
    active: true,
  },
  {
    id: 'md-emaryland',
    title: 'Maryland — eMMA',
    url: 'https://emma.maryland.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Maryland',
    active: true,
  },
  {
    id: 'nj-njstart',
    title: 'New Jersey — NJSTART',
    url: 'https://www.njstart.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'New Jersey',
    active: true,
  },
  {
    id: 'mn-swift',
    title: 'Minnesota — SWIFT',
    url: 'https://supplier.swift.state.mn.us/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Minnesota',
    active: true,
  },
  {
    id: 'wi-vendornet',
    title: 'Wisconsin — VendorNet',
    url: 'https://vendornet.wi.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Wisconsin',
    active: true,
  },
  {
    id: 'nyc-passport',
    title: 'NYC — PASSPort',
    url: 'https://www.nyc.gov/site/mocs/passport/about-passport.page',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'New York City',
    active: true,
  },
  {
    id: 'la-city',
    title: 'Los Angeles — BAVN',
    url: 'https://www.labavn.org/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Los Angeles',
    active: true,
  },
  {
    id: 'chicago-procurement',
    title: 'Chicago — Procurement Services',
    url: 'https://www.chicago.gov/city/en/depts/dps.html',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Chicago',
    active: true,
  },
]

export const ALL_PROCUREMENT_INDEX_SEEDS: ProcurementIndexSeed[] = [
  ...PROCUREMENT_RSS_SEEDS,
  ...PROCUREMENT_PORTAL_SEEDS,
]

export function getActiveRssSeeds(): ProcurementIndexSeed[] {
  return PROCUREMENT_RSS_SEEDS.filter(s => s.active && s.kind === 'rss')
}

export function rssSeedToFeedSource(seed: ProcurementIndexSeed) {
  return {
    url: seed.url,
    title: seed.title,
    category: seed.category === 'grants' ? 'procurement' : seed.category,
    active: seed.active,
    lastFetched: null as Date | null,
  }
}
