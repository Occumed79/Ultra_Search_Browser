/**
 * Procurement / RFP local index — seed catalog
 * PUBLIC sources only (no vendor login to *read* listings).
 */

export type IndexSourceKind = 'rss' | 'portal' | 'api'

export type IndexCategory =
  | 'procurement'
  | 'government'
  | 'grants'
  | 'healthcare_procurement'
  | 'education'
  | 'fire_ems'
  | 'water_utility'
  | 'transit'
  | 'special_district'

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
  { id: 'fr-notices', title: 'Federal Register — Notices', url: `${FR}?conditions%5Btype%5D%5B%5D=NOTICE`, kind: 'rss', category: 'government', jurisdiction: 'US Federal', active: true },
  { id: 'fr-prorule', title: 'Federal Register — Proposed Rules', url: `${FR}?conditions%5Btype%5D%5B%5D=PRORULE`, kind: 'rss', category: 'government', jurisdiction: 'US Federal', active: true },
  { id: 'fr-rule', title: 'Federal Register — Rules', url: `${FR}?conditions%5Btype%5D%5B%5D=RULE`, kind: 'rss', category: 'government', jurisdiction: 'US Federal', active: true },
  { id: 'grants-gov-agency', title: 'Grants.gov — New by Agency', url: 'https://www.grants.gov/rss/GG_NewOppByAgency.xml', kind: 'rss', category: 'grants', jurisdiction: 'US Federal', notes: 'HTML challenge from many hosts', active: false },
]

export const STATE_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  { id: 'sam-gov', title: 'SAM.gov Contract Opportunities', url: 'https://sam.gov/opportunities', kind: 'portal', category: 'procurement', jurisdiction: 'US Federal', active: true },
  { id: 'sam-api', title: 'SAM.gov Opportunities API', url: 'https://api.sam.gov/opportunities/v2/search', kind: 'api', category: 'procurement', jurisdiction: 'US Federal', notes: 'Free public API key', active: true },
  { id: 'ca-caleprocure', title: 'California — Cal eProcure', url: 'https://caleprocure.ca.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'California', active: true },
  { id: 'tx-esbd', title: 'Texas — ESBD', url: 'https://www.txsmartbuy.com/esbd', kind: 'portal', category: 'procurement', jurisdiction: 'Texas', active: true },
  { id: 'ny-nyscr', title: 'New York — Contract Reporter', url: 'https://www.nyscr.ny.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'New York', active: true },
  { id: 'il-bidbuy', title: 'Illinois — BidBuy', url: 'https://www.bidbuy.illinois.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Illinois', active: true },
  { id: 'fl-mfmp', title: 'Florida — MyFloridaMarketPlace', url: 'https://vendor.myfloridamarketplace.com/', kind: 'portal', category: 'procurement', jurisdiction: 'Florida', active: true },
  { id: 'wa-webs', title: 'Washington — WEBS', url: 'https://pr-webs-vendor.des.wa.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Washington', active: true },
  { id: 'or-oregonbuys', title: 'Oregon — OregonBuys', url: 'https://oregonbuys.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Oregon', active: true },
  { id: 'az-app', title: 'Arizona — APP', url: 'https://app.az.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Arizona', active: true },
  { id: 'co-vss', title: 'Colorado — VSS', url: 'https://www.colorado.gov/vss', kind: 'portal', category: 'procurement', jurisdiction: 'Colorado', active: true },
  { id: 'ga-team', title: 'Georgia — Team Georgia Marketplace', url: 'https://ssl.doas.state.ga.us/PRSapp/', kind: 'portal', category: 'procurement', jurisdiction: 'Georgia', active: true },
  { id: 'nc-evp', title: 'North Carolina — eVP Solicitations', url: 'https://evp.nc.gov/solicitations/', kind: 'portal', category: 'procurement', jurisdiction: 'North Carolina', active: true },
  { id: 'pa-emarket', title: 'Pennsylvania — eMarketplace', url: 'https://www.emarketplace.state.pa.us/', kind: 'portal', category: 'procurement', jurisdiction: 'Pennsylvania', active: true },
  { id: 'oh-buys', title: 'Ohio — OhioBuys', url: 'https://ohiobuys.ohio.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Ohio', active: true },
  { id: 'mi-sigma', title: 'Michigan — SIGMA VSS', url: 'https://sigma.michigan.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Michigan', active: true },
  { id: 'ma-commbuys', title: 'Massachusetts — COMMBUYS', url: 'https://www.commbuys.com/', kind: 'portal', category: 'procurement', jurisdiction: 'Massachusetts', active: true },
  { id: 'va-eva', title: 'Virginia — eVA', url: 'https://eva.virginia.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Virginia', active: true },
  { id: 'md-emma', title: 'Maryland — eMMA', url: 'https://emma.maryland.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Maryland', active: true },
  { id: 'nj-njstart', title: 'New Jersey — NJSTART', url: 'https://www.njstart.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'New Jersey', active: true },
  { id: 'wi-vendornet', title: 'Wisconsin — VendorNet', url: 'https://vendornet.wi.gov/', kind: 'portal', category: 'procurement', jurisdiction: 'Wisconsin', active: true },
  { id: 'mn-swift', title: 'Minnesota — SWIFT', url: 'https://supplier.swift.state.mn.us/', kind: 'portal', category: 'procurement', jurisdiction: 'Minnesota', active: true },
]

export const EDUCATION_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  { id: 'edu-ucop', title: 'University of California — Procurement', url: 'https://www.ucop.edu/procurement-services/', kind: 'portal', category: 'education', jurisdiction: 'California', active: true },
  { id: 'edu-calstate', title: 'CSU — Doing Business with the CSU', url: 'https://www.calstate.edu/csu-system/doing-business-with-the-csu', kind: 'portal', category: 'education', jurisdiction: 'California', active: true },
  { id: 'edu-ucla', title: 'UCLA — Purchasing', url: 'https://purchasing.ucla.edu/', kind: 'portal', category: 'education', jurisdiction: 'California', active: true },
  { id: 'edu-berkeley', title: 'UC Berkeley — Supply Chain', url: 'https://supplychain.berkeley.edu/', kind: 'portal', category: 'education', jurisdiction: 'California', active: true },
  { id: 'edu-stanford', title: 'Stanford — Procurement', url: 'https://procurement.stanford.edu/', kind: 'portal', category: 'education', jurisdiction: 'California', active: true },
  { id: 'edu-losrios', title: 'Los Rios CCD — Doing Business', url: 'https://losrios.edu/community/doing-business-with-los-rios', kind: 'portal', category: 'education', jurisdiction: 'Sacramento CA', active: true },
  { id: 'edu-rccd', title: 'Riverside CCD — Purchasing', url: 'https://rccd.edu/admin/bfs/bs/purchasing.html', kind: 'portal', category: 'education', jurisdiction: 'Riverside CA', active: true },
  { id: 'edu-lausd', title: 'LAUSD — Procurement', url: 'https://www.lausd.org/Page/16409', kind: 'portal', category: 'education', jurisdiction: 'Los Angeles', active: true },
  { id: 'edu-ut-system', title: 'UT System — Procurement', url: 'https://www.utsystem.edu/offices/business-affairs/procurement', kind: 'portal', category: 'education', jurisdiction: 'Texas', active: true },
  { id: 'edu-tamu', title: 'Texas A&M — Purchasing', url: 'https://purchasing.tamu.edu/', kind: 'portal', category: 'education', jurisdiction: 'Texas', active: true },
  { id: 'edu-utaustin', title: 'UT Austin — Procurement', url: 'https://procurement.utexas.edu/', kind: 'portal', category: 'education', jurisdiction: 'Texas', active: true },
  { id: 'edu-osu', title: 'Ohio State — Buy', url: 'https://busfin.osu.edu/buy', kind: 'portal', category: 'education', jurisdiction: 'Ohio', active: true },
  { id: 'edu-umich', title: 'University of Michigan — Procurement', url: 'https://procurement.umich.edu/', kind: 'portal', category: 'education', jurisdiction: 'Michigan', active: true },
  { id: 'edu-psu', title: 'Penn State — Purchasing', url: 'https://purchasing.psu.edu/', kind: 'portal', category: 'education', jurisdiction: 'Pennsylvania', active: true },
  { id: 'edu-uiuc', title: 'University of Illinois — Purchases', url: 'https://www.obfs.uillinois.edu/purchases/', kind: 'portal', category: 'education', jurisdiction: 'Illinois', active: true },
  { id: 'edu-uw', title: 'University of Washington — Procurement', url: 'https://finance.uw.edu/ps/', kind: 'portal', category: 'education', jurisdiction: 'Washington', active: true },
  { id: 'edu-asu', title: 'Arizona State — Purchasing', url: 'https://cfo.asu.edu/purchasing', kind: 'portal', category: 'education', jurisdiction: 'Arizona', active: true },
  { id: 'edu-ufl', title: 'University of Florida — Procurement', url: 'https://procurement.ufl.edu/', kind: 'portal', category: 'education', jurisdiction: 'Florida', active: true },
  { id: 'edu-fsu', title: 'Florida State — Procurement', url: 'https://procurement.fsu.edu/', kind: 'portal', category: 'education', jurisdiction: 'Florida', active: true },
  { id: 'edu-gatech', title: 'Georgia Tech — Procurement', url: 'https://www.procurement.gatech.edu/', kind: 'portal', category: 'education', jurisdiction: 'Georgia', active: true },
  { id: 'edu-virginia', title: 'University of Virginia — Procurement', url: 'https://www.procurement.virginia.edu/', kind: 'portal', category: 'education', jurisdiction: 'Virginia', active: true },
  { id: 'edu-harvard', title: 'Harvard — Strategic Procurement', url: 'https://procurement.harvard.edu/', kind: 'portal', category: 'education', jurisdiction: 'Massachusetts', active: true },
  { id: 'edu-mit', title: 'MIT — VPF Procurement', url: 'https://vpf.mit.edu/procurement', kind: 'portal', category: 'education', jurisdiction: 'Massachusetts', active: true },
  { id: 'edu-columbia', title: 'Columbia — Purchasing', url: 'https://purchasing.columbia.edu/', kind: 'portal', category: 'education', jurisdiction: 'New York', active: true },
  { id: 'edu-tbr', title: 'Tennessee Board of Regents — Bids', url: 'https://www.tbr.edu/purchasing/bids', kind: 'portal', category: 'education', jurisdiction: 'Tennessee', active: true },
  { id: 'edu-jccc', title: 'Johnson County CC — Bid Opportunities', url: 'https://www.jccc.edu/about/leadership-governance/administration/procurement-services/bid-opportunities.html', kind: 'portal', category: 'education', jurisdiction: 'Kansas', active: true },
  { id: 'edu-cps', title: 'Chicago Public Schools — Procurement', url: 'https://www.cps.edu/about/departments/procurement/', kind: 'portal', category: 'education', jurisdiction: 'Chicago', active: true },
  { id: 'edu-nycdoe', title: 'NYC DOE — Doing Business', url: 'https://www.schools.nyc.gov/about-us/funding/doing-business-with-the-doe', kind: 'portal', category: 'education', jurisdiction: 'New York City', active: true },
]

export const FIRE_EMS_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  { id: 'fire-la-county', title: 'LA County Fire', url: 'https://fire.lacounty.gov/', kind: 'portal', category: 'fire_ems', jurisdiction: 'Los Angeles County', active: true },
  { id: 'fire-ocfa', title: 'Orange County Fire Authority', url: 'https://www.ocfa.org/', kind: 'portal', category: 'fire_ems', jurisdiction: 'Orange County CA', active: true },
  { id: 'fire-sf', title: 'SF City Partner Portal (incl. Fire)', url: 'https://sfcitypartner.sfgov.org/', kind: 'portal', category: 'fire_ems', jurisdiction: 'San Francisco', active: true },
  { id: 'fire-chicago', title: 'Chicago DPS (incl. Fire)', url: 'https://www.chicago.gov/city/en/depts/dps.html', kind: 'portal', category: 'fire_ems', jurisdiction: 'Chicago', active: true },
  { id: 'fire-fdny', title: 'NYC PASSPort (incl. FDNY)', url: 'https://www.nyc.gov/site/mocs/passport/about-passport.page', kind: 'portal', category: 'fire_ems', jurisdiction: 'New York City', active: true },
  { id: 'fire-phx', title: 'Phoenix Procurement (incl. Fire)', url: 'https://www.phoenix.gov/financesite/Pages/Procurement.aspx', kind: 'portal', category: 'fire_ems', jurisdiction: 'Phoenix', active: true },
  { id: 'fire-hou', title: 'Houston Purchasing (incl. Fire)', url: 'https://purchasing.houstontx.gov/', kind: 'portal', category: 'fire_ems', jurisdiction: 'Houston', active: true },
  { id: 'fire-dal', title: 'Dallas Procurement (incl. Fire)', url: 'https://dallascityhall.com/departments/procurement/', kind: 'portal', category: 'fire_ems', jurisdiction: 'Dallas', active: true },
  { id: 'fire-king', title: 'King County Procurement', url: 'https://kingcounty.gov/en/dept/executive-services/about-king-county/about-office-of-the-executive/procurement', kind: 'portal', category: 'fire_ems', jurisdiction: 'King County WA', active: true },
]

export const WATER_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  { id: 'water-mwd', title: 'MWD Southern California — Doing Business', url: 'https://www.mwdh2o.com/doing-business-with-us/', kind: 'portal', category: 'water_utility', jurisdiction: 'Southern California', active: true },
  { id: 'water-sfpuc', title: 'SFPUC — Bids & Contracts', url: 'https://www.sfpuc.gov/about-us/bids-contracts', kind: 'portal', category: 'water_utility', jurisdiction: 'San Francisco', active: true },
  { id: 'water-ladwp', title: 'LADWP — Doing Business', url: 'https://www.ladwp.com/ladwp/faces/ladwp/aboutus/a-doingbusiness', kind: 'portal', category: 'water_utility', jurisdiction: 'Los Angeles', active: true },
  { id: 'water-ebmud', title: 'East Bay MUD — Business Center', url: 'https://www.ebmud.com/business-center/', kind: 'portal', category: 'water_utility', jurisdiction: 'East Bay CA', active: true },
  { id: 'water-ocwd', title: 'Orange County Water District', url: 'https://www.ocwd.com/', kind: 'portal', category: 'water_utility', jurisdiction: 'Orange County CA', active: true },
  { id: 'water-mwrd', title: 'MWRD Greater Chicago — Procurement', url: 'https://mwrd.org/procurement', kind: 'portal', category: 'water_utility', jurisdiction: 'Chicago', active: true },
  { id: 'water-nyc-dep', title: 'NYC DEP — Procurement', url: 'https://www.nyc.gov/site/dep/about/procurement.page', kind: 'portal', category: 'water_utility', jurisdiction: 'New York City', active: true },
  { id: 'water-denver', title: 'Denver Water — Contractors', url: 'https://www.denverwater.org/contractors', kind: 'portal', category: 'water_utility', jurisdiction: 'Denver', active: true },
  { id: 'water-seattle', title: 'Seattle Public Utilities — Doing Business', url: 'https://www.seattle.gov/utilities/about-us/doing-business', kind: 'portal', category: 'water_utility', jurisdiction: 'Seattle', active: true },
  { id: 'water-austin', title: 'Austin Purchasing (incl. Water)', url: 'https://www.austintexas.gov/department/purchasing', kind: 'portal', category: 'water_utility', jurisdiction: 'Austin TX', active: true },
  { id: 'water-phx', title: 'Phoenix Water Services', url: 'https://www.phoenix.gov/waterservices', kind: 'portal', category: 'water_utility', jurisdiction: 'Phoenix', active: true },
]

export const SPECIAL_DISTRICT_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  { id: 'transit-la-metro', title: 'LA Metro — Business Community', url: 'https://www.metro.net/about/business-community/', kind: 'portal', category: 'transit', jurisdiction: 'Los Angeles', active: true },
  { id: 'transit-mta', title: 'MTA NY — Procurement', url: 'https://new.mta.info/doing-business-with-us/procurement', kind: 'portal', category: 'transit', jurisdiction: 'New York', active: true },
  { id: 'transit-cta', title: 'Chicago CTA — Procurement', url: 'https://www.transitchicago.com/procurement/', kind: 'portal', category: 'transit', jurisdiction: 'Chicago', active: true },
  { id: 'transit-bart', title: 'BART — Business', url: 'https://www.bart.gov/about/business', kind: 'portal', category: 'transit', jurisdiction: 'Bay Area', active: true },
  { id: 'transit-wmata', title: 'WMATA — Procurement', url: 'https://www.wmata.com/business/procurement/', kind: 'portal', category: 'transit', jurisdiction: 'DC Metro', active: true },
  { id: 'port-la', title: 'Port of Los Angeles — Business', url: 'https://www.portoflosangeles.org/business', kind: 'portal', category: 'special_district', jurisdiction: 'Los Angeles', active: true },
  { id: 'port-lb', title: 'Port of Long Beach — Business', url: 'https://polb.com/business/', kind: 'portal', category: 'special_district', jurisdiction: 'Long Beach', active: true },
  { id: 'port-nynj', title: 'Port Authority NY/NJ — Business', url: 'https://www.panynj.gov/port-authority/en/business-opportunities.html', kind: 'portal', category: 'special_district', jurisdiction: 'NY/NJ', active: true },
  { id: 'airport-lax', title: 'LAWA / LAX — Businesses', url: 'https://www.lawa.org/lawa-businesses', kind: 'portal', category: 'special_district', jurisdiction: 'Los Angeles', active: true },
  { id: 'airport-ord', title: 'Chicago Airports — Business', url: 'https://www.flychicago.com/business/Pages/default.aspx', kind: 'portal', category: 'special_district', jurisdiction: 'Chicago', active: true },
  { id: 'city-nyc', title: 'NYC PASSPort', url: 'https://www.nyc.gov/site/mocs/passport/about-passport.page', kind: 'portal', category: 'procurement', jurisdiction: 'New York City', active: true },
  { id: 'city-la', title: 'Los Angeles BAVN', url: 'https://www.labavn.org/', kind: 'portal', category: 'procurement', jurisdiction: 'Los Angeles', active: true },
  { id: 'city-chi', title: 'Chicago DPS', url: 'https://www.chicago.gov/city/en/depts/dps.html', kind: 'portal', category: 'procurement', jurisdiction: 'Chicago', active: true },
]

export const PROCUREMENT_PORTAL_SEEDS: ProcurementIndexSeed[] = [
  ...STATE_PORTAL_SEEDS,
  ...EDUCATION_PORTAL_SEEDS,
  ...FIRE_EMS_PORTAL_SEEDS,
  ...WATER_PORTAL_SEEDS,
  ...SPECIAL_DISTRICT_PORTAL_SEEDS,
]

export const ALL_PROCUREMENT_INDEX_SEEDS: ProcurementIndexSeed[] = [
  ...PROCUREMENT_RSS_SEEDS,
  ...PROCUREMENT_PORTAL_SEEDS,
]

export function getActiveRssSeeds(): ProcurementIndexSeed[] {
  return PROCUREMENT_RSS_SEEDS.filter(s => s.active && s.kind === 'rss')
}

export function getPortalSeedsByCategory(category?: IndexCategory): ProcurementIndexSeed[] {
  const portals = PROCUREMENT_PORTAL_SEEDS.filter(s => s.active)
  if (!category) return portals
  return portals.filter(s => s.category === category)
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

export function seedCatalogSummary() {
  const all = ALL_PROCUREMENT_INDEX_SEEDS
  const byKind: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  for (const s of all) {
    byKind[s.kind] = (byKind[s.kind] || 0) + 1
    byCategory[s.category] = (byCategory[s.category] || 0) + 1
  }
  return { total: all.length, active: all.filter(s => s.active).length, byKind, byCategory }
}
