/**
 * Procurement / RFP local index — seed sources
 *
 * These are PUBLIC sources that do not require a vendor login to *read*
 * opportunity listings or RSS. Use them to populate feed_sources / feed_entries
 * once DATABASE_URL is configured.
 *
 * Types:
 *   - rss   → fetch with scripts/fetch-feeds.ts (XML)
 *   - portal → public list/search pages (future HTML indexer; do not scrape behind login)
 *   - api   → documented public API (may need free API key later)
 *
 * Prefer official .gov sources. Commercial aggregators (BidNet, DemandStar, etc.)
 * are omitted because they typically require accounts.
 */

export type IndexSourceKind = 'rss' | 'portal' | 'api'

export type IndexCategory =
  | 'procurement'
  | 'government'
  | 'grants'
  | 'healthcare_procurement'

export interface ProcurementIndexSeed {
  /** Stable id for logging / dedupe */
  id: string
  /** Human label */
  title: string
  /** Feed or page URL */
  url: string
  kind: IndexSourceKind
  category: IndexCategory
  /** Jurisdiction hint */
  jurisdiction: string
  /** Why this source is useful */
  notes?: string
  /** If false, skip automatic RSS fetch (portal/api only) */
  active: boolean
}

/**
 * Tier 1 — verified public RSS / Atom feeds (safe for fetch-feeds.ts today)
 */
export const PROCUREMENT_RSS_SEEDS: ProcurementIndexSeed[] = [
  // ── Federal grants (not pure contracts, but adjacent public opportunities) ──
  {
    id: 'grants-gov-new-by-agency',
    title: 'Grants.gov — New Opportunities by Agency',
    url: 'https://www.grants.gov/rss/GG_NewOppByAgency.xml',
    kind: 'rss',
    category: 'grants',
    jurisdiction: 'US Federal',
    notes: 'Official Grants.gov RSS; no login',
    active: true,
  },
  {
    id: 'grants-gov-new-by-category',
    title: 'Grants.gov — New Opportunities by Category',
    url: 'https://www.grants.gov/rss/GG_NewOppByCategory.xml',
    kind: 'rss',
    category: 'grants',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'grants-gov-mod-by-agency',
    title: 'Grants.gov — Modified Opportunities by Agency',
    url: 'https://www.grants.gov/rss/GG_OppModByAgency.xml',
    kind: 'rss',
    category: 'grants',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'grants-gov-mod-by-category',
    title: 'Grants.gov — Modified Opportunities by Category',
    url: 'https://www.grants.gov/rss/GG_OppModByCategory.xml',
    kind: 'rss',
    category: 'grants',
    jurisdiction: 'US Federal',
    active: true,
  },

  // ── Federal Register (public notices; procurement-adjacent) ──
  {
    id: 'fr-notices',
    title: 'Federal Register — Notices',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Btype%5D%5B%5D=NOTICE',
    kind: 'rss',
    category: 'government',
    jurisdiction: 'US Federal',
    notes: 'Official FR RSS via documents API path',
    active: true,
  },
  {
    id: 'fr-proposed-rules',
    title: 'Federal Register — Proposed Rules',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Btype%5D%5B%5D=PRORULE',
    kind: 'rss',
    category: 'government',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-gsa',
    title: 'Federal Register — GSA documents',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=general-services-administration',
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    notes: 'GSA often posts acquisition-related notices',
    active: true,
  },
  {
    id: 'fr-hhs',
    title: 'Federal Register — HHS documents',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=health-and-human-services-department',
    kind: 'rss',
    category: 'healthcare_procurement',
    jurisdiction: 'US Federal',
    notes: 'Useful for occupational health / clinical services adjacent RFPs',
    active: true,
  },
  {
    id: 'fr-va',
    title: 'Federal Register — Veterans Affairs',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=veterans-affairs-department',
    kind: 'rss',
    category: 'healthcare_procurement',
    jurisdiction: 'US Federal',
    active: true,
  },
  {
    id: 'fr-dod',
    title: 'Federal Register — Defense Department',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=defense-department',
    kind: 'rss',
    category: 'procurement',
    jurisdiction: 'US Federal',
    active: true,
  },

  // ── Agency newsrooms (weak signal; still public, no login) ──
  {
    id: 'gsa-news',
    title: 'GSA Newsroom RSS',
    url: 'https://www.gsa.gov/rss/news.xml',
    kind: 'rss',
    category: 'government',
    jurisdiction: 'US Federal',
    notes: 'Verify URL if GSA changes feed paths; disable if 404',
    active: true,
  },
]

/**
 * Tier 2 — public portals (list pages visible without login).
 * Not RSS; intended for a future list-page / sitemap indexer.
 * Still recorded so the index catalog is complete when DATABASE_URL is set.
 */
export const PROCUREMENT_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  // Federal
  {
    id: 'sam-gov-opportunities',
    title: 'SAM.gov Contract Opportunities',
    url: 'https://sam.gov/opportunities',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'US Federal',
    notes: 'Primary federal contract board. Public search UI; bulk/API may need free API key.',
    active: true,
  },
  {
    id: 'sam-gov-api',
    title: 'SAM.gov Get Opportunities Public API',
    url: 'https://api.sam.gov/opportunities/v2/search',
    kind: 'api',
    category: 'procurement',
    jurisdiction: 'US Federal',
    notes: 'Requires free SAM.gov public API key — best long-term federal indexer',
    active: true,
  },
  {
    id: 'usaspending',
    title: 'USAspending.gov',
    url: 'https://www.usaspending.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'US Federal',
    notes: 'Awards / spend transparency, not open solicitations',
    active: true,
  },

  // State e-procurement (public browse; posting may require login)
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
    title: 'Texas — Electronic State Business Daily (ESBD)',
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
    title: 'Florida — MyFloridaMarketPlace / Vendor Information Portal',
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
    title: 'Colorado — ColoradoVSS / BIDS',
    url: 'https://www.colorado.gov/vss',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Colorado',
    active: true,
  },
  {
    id: 'az-app',
    title: 'Arizona — APP (Arizona Procurement Portal)',
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
    title: 'North Carolina — Interactive Purchasing System',
    url: 'https://www.ips.state.nc.us/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'North Carolina',
    active: true,
  },
  {
    id: 'pa-emarket',
    title: 'Pennsylvania — PA eMarketplace',
    url: 'https://www.emarketplace.state.pa.us/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Pennsylvania',
    active: true,
  },
  {
    id: 'oh-procure',
    title: 'Ohio — OhioBuys / Procurement',
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
    title: 'Maryland — eMaryland Marketplace Advantage',
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
    title: 'Minnesota — SWIFT Supplier Portal',
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
    id: 'in-ionwave',
    title: 'Indiana — IDOA Procurement',
    url: 'https://www.in.gov/idoa/procurement/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Indiana',
    active: true,
  },
  {
    id: 'tn-edison',
    title: 'Tennessee — Edison Supplier Portal',
    url: 'https://www.tn.gov/generalservices/procurement.html',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Tennessee',
    active: true,
  },
  {
    id: 'mo-missouribuys',
    title: 'Missouri — MissouriBUYS',
    url: 'https://missouribuys.mo.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Missouri',
    active: true,
  },
  {
    id: 'la-lapac',
    title: 'Louisiana — LaPAC',
    url: 'https://wwwcfprd.doa.louisiana.gov/osp/lapac/pubMain.cfm',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Louisiana',
    active: true,
  },
  {
    id: 'ok-okgov',
    title: 'Oklahoma — OMES Central Purchasing',
    url: 'https://oklahoma.gov/omes/services/purchasing.html',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Oklahoma',
    active: true,
  },
  {
    id: 'nm-gsa',
    title: 'New Mexico — State Purchasing',
    url: 'https://www.generalservices.state.nm.us/statepurchasing/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'New Mexico',
    active: true,
  },
  {
    id: 'nv-nevadaepro',
    title: 'Nevada — NevadaEPro',
    url: 'https://nevadaepro.com/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Nevada',
    active: true,
  },
  {
    id: 'ut-purchasing',
    title: 'Utah — State Purchasing',
    url: 'https://purchasing.utah.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Utah',
    active: true,
  },
  {
    id: 'hi-hands',
    title: 'Hawaii — HIePRO',
    url: 'https://hiepro.ehawaii.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Hawaii',
    active: true,
  },
  {
    id: 'ak-iris',
    title: 'Alaska — IRIS / Procurement',
    url: 'https://iris-vss.alaska.gov/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Alaska',
    active: true,
  },

  // Large local / special districts often post publicly
  {
    id: 'nyc-passport',
    title: 'New York City — PASSPort / City Record',
    url: 'https://www.nyc.gov/site/mocs/passport/about-passport.page',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'New York City',
    active: true,
  },
  {
    id: 'la-city',
    title: 'City of Los Angeles — Business Assistance Virtual Network',
    url: 'https://www.labavn.org/',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Los Angeles',
    active: true,
  },
  {
    id: 'chicago-procurement',
    title: 'City of Chicago — Procurement Services',
    url: 'https://www.chicago.gov/city/en/depts/dps.html',
    kind: 'portal',
    category: 'procurement',
    jurisdiction: 'Chicago',
    active: true,
  },
]

/** All seeds */
export const ALL_PROCUREMENT_INDEX_SEEDS: ProcurementIndexSeed[] = [
  ...PROCUREMENT_RSS_SEEDS,
  ...PROCUREMENT_PORTAL_SEEDS,
]

/** Only RSS rows suitable for the current feed fetcher */
export function getActiveRssSeeds(): ProcurementIndexSeed[] {
  return PROCUREMENT_RSS_SEEDS.filter(s => s.active && s.kind === 'rss')
}

/** Map seed → shape expected by small-web addFeedSource */
export function rssSeedToFeedSource(seed: ProcurementIndexSeed) {
  return {
    url: seed.url,
    title: seed.title,
    category: seed.category === 'grants' ? 'procurement' : seed.category,
    active: seed.active,
    lastFetched: null as Date | null,
  }
}
