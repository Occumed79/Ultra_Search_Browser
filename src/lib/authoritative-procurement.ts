/**
 * Adapter over unchanged MIT-licensed @cliwant/mcp-sam-gov connectors.
 * Procurement fit from Neon is independent from authoritative OPEN status.
 * Only an exact source-portal identity may carry an "Opportunity verified" badge.
 */
import { searchSolicitations } from '../vendor/cliwant/opengov'
import { searchOpportunities } from '../vendor/cliwant/bonfire'
import { SamGovClient } from '../vendor/cliwant/sam-gov/client'
import type { SamOpportunity } from '../vendor/cliwant/sam-gov/types'
import type { RfpOpportunityIntelligence } from './rfp-opportunity-intelligence'
import type { ScrapedResult } from '../types/search'

type Candidate = ScrapedResult & {
  rfpIntelligence?: RfpOpportunityIntelligence
  canonicalDecision?: { decision: string; reason?: string; [key: string]: unknown }
}
type GovRecord = { id?: number | null; title?: string | null; solicitationNumber?: string | null; status?: string | null; proposalDeadline?: string | null; department?: string | null; link?: string | null }
type BonRecord = { referenceNumber?: string | null; name?: string | null; closeDate?: string | null; link?: string | null }
export type AuthorityVerdict = 'open' | 'closed' | 'unverified'
export interface AuthorityEvidence {
  verdict: AuthorityVerdict
  source: 'OpenGov' | 'Bonfire' | 'SAM.gov' | 'unsupported'
  reason: string
  checkedAt: string
  sourceUrl?: string
  buyer?: string
  solicitationNumber?: string
  deadline?: string
  title?: string
}
export interface OfficialLookups {
  opengov?: (args: {governmentCode: string;limit: number;offset: number}) => Promise<{data: {solicitations: GovRecord[]};meta?: {pagination?: {hasMore?: boolean}}}>
  bonfire?: (args: {org: string;limit: number;offset: number}) => Promise<{data: {opportunities: BonRecord[]}}>
  sam?: (id: string) => Promise<SamOpportunity | null>
}
export interface OfficialGateResult {
  verified: ScrapedResult[]
  review: ScrapedResult[]
  closed: ScrapedResult[]
  diagnostics: {checked: number;open: number;closed: number;review: number;unsupported: number;limited: number}
}
const MAX_LOOKUPS = 12
const LOOKUP_MS = 3200
const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()

const TITLE_STOP_WORDS = new Set(['and','the','for','with','from','of','a','an','by','on','to','rfp','rfq','ifb','bid','solicitation','opportunity','services','service','contract','request','proposal','proposals','project','notice'])
function substantiveWords(input: string | null | undefined): Set<string> {
  return new Set(clean(input).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !TITLE_STOP_WORDS.has(word)))
}
function similarity(left: string | null | undefined, right: string | null | undefined): number {
  const a=substantiveWords(left),b=substantiveWords(right)
  if(a.size < 2 || b.size < 2) return 0
  let matches=0
  for(const word of a) if(b.has(word)) matches++
  if(matches < 2) return 0
  return (2*matches)/(a.size+b.size)
}
function normalId(value: string | null | undefined): string {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g,'')
}
function isStrongId(value: string): boolean {
  return value.length >= 6 && /\d/.test(value) && /[A-Z0-9]/.test(value)
}
/** A third-party link alone is never an identity proof: independent title and
 * solicitation number, or title and buyer, must corroborate the original. */
function linkedRecordMatches(candidate: Candidate, proof: AuthorityEvidence): boolean {
  const title=similarity(candidate.rfpIntelligence?.title || candidate.title, proof.title)
  const candidateId=normalId(candidate.rfpIntelligence?.solicitationNumber)
  const officialId=normalId(proof.solicitationNumber)
  const idMatch=isStrongId(candidateId) && candidateId===officialId
  const buyerMatch=similarity(candidate.rfpIntelligence?.organization,proof.buyer)>=0.75
  return (idMatch && title>=0.40) || (title>=0.82 && buyerMatch)
}

function pathKey(raw: string) {
  try {
    const u = new URL(raw)
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.toLowerCase().replace(/\/+$/, '')
  } catch { return '' }
}
function identifyTarget(raw: string): {platform:'opengov';code:string;id:number} | {platform:'bonfire';org:string} | {platform:'sam';id:string} | undefined {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return
    const hostname = u.hostname.toLowerCase()
    if (hostname === 'procurement.opengov.com') {
      const m = u.pathname.match(/^\/portal\/([a-z0-9-]{1,64})\/projects\/(\d+)(?:\/|$)/i)
      if (m) return {platform:'opengov',code:m[1].toLowerCase(),id:Number(m[2])}
    }
    const m = hostname.match(/^([a-z0-9-]{1,64})\.bonfirehub\.com$/)
    if (m && /^\/opportunities\/[^/]+/i.test(u.pathname)) return {platform:'bonfire',org:m[1]}
    if (hostname === 'sam.gov' || hostname === 'www.sam.gov') {
      const found = u.pathname.match(/^\/opp\/([a-f0-9-]{32,36})(?:\/|$)/i)
      if (found) {
        const id = found[1].replace(/-/g,'').toLowerCase()
        if (/^[a-f0-9]{32}$/.test(id)) return {platform:'sam',id}
      }
    }
  } catch { /* not an official target */ }
}
function future(value: string | null | undefined, now: Date) {
  if (!value) return false
  const dateOnly = /^\d{4}-\d{1,2}-\d{1,2}$/.test(value.trim())
  const timestamp = new Date(value).getTime()
  // A source that specifies only a calendar date has not supplied a time zone
  // or an hour. Keep it eligible through that UTC calendar day; do not invent
  // an exact local submission time.
  return Number.isFinite(timestamp) && (dateOnly ? timestamp+86_400_000 : timestamp) > now.getTime()
}
function iso(value: string | null | undefined) {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10) : undefined
}
function result(verdict: AuthorityVerdict, source: AuthorityEvidence['source'], reason: string, fields: Partial<AuthorityEvidence> = {}): AuthorityEvidence {
  return {verdict,source,reason,checkedAt:new Date().toISOString(),...fields}
}
async function bounded<T>(operation: () => Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Official data source timed out')),LOOKUP_MS)})])
  } finally {if(timer)clearTimeout(timer)}
}
const samClient = new SamGovClient({apiKey:process.env.SAM_GOV_API_KEY || undefined, userAgent:process.env.SEC_USER_AGENT || 'Ultra Search Browser procurement verification'})

/** Only primary-source ID matching may confirm active procurement. */
export async function verifyOfficialOpportunity(raw: ScrapedResult, lookups: OfficialLookups = {}, now = new Date()): Promise<AuthorityEvidence> {
  const candidate = raw as Candidate
  const target = identifyTarget(candidate.pageValidation?.finalUrl || candidate.url)
  if (!target) {
    // Recover original procurement records ONLY from explicitly labeled links
    // captured from this candidate's actual page. No guessed URLs or title
    // searches, and never trust a related-item link without identity agreement.
    const links = candidate.pageValidation?.officialSourceLinks?.slice(0,2) || []
    for (const link of links) {
      if (!identifyTarget(link.url)) continue
      const officialCandidate: Candidate = {...candidate, url:link.url, pageValidation:undefined}
      const proof=await verifyOfficialOpportunity(officialCandidate,lookups,now)
      if (proof.source === 'unsupported' || proof.verdict === 'unverified') continue
      if (!linkedRecordMatches(candidate,proof)) continue
      return {...proof, reason: proof.reason+' Matched to original-source link using independent solicitation identity and title.'}
    }
    return result('unverified','unsupported',
      links.length ? 'Original-source links were checked, but official status or solicitation identity could not be independently corroborated.'
        : 'No supported issuing-portal record was identified. A search result or third-party listing cannot verify open status.')
  }
  try {
    if (target.platform === 'opengov') {
      for (let page=0;page<3;page++) {
        const args = {governmentCode:target.code,limit:100,offset:page*100}
        const response = lookups.opengov
          ? await bounded(()=>lookups.opengov!(args))
          : await bounded(()=>searchSolicitations(args))
        const data = response.data as {solicitations: GovRecord[]}
        const match = data.solicitations.find(item=>item.id === target.id)
        if (!match) {
          if (response.meta?.pagination?.hasMore === false || data.solicitations.length === 0) break
          continue
        }
        const fields={sourceUrl:match.link || candidate.url,buyer:match.department || undefined,solicitationNumber:match.solicitationNumber || undefined,title:match.title || undefined,deadline:iso(match.proposalDeadline)}
        const status = clean(match.status).toLowerCase()
        if (['closed','evaluation','awarded','cancelled','canceled','archived','completed'].includes(status)) return result('closed','OpenGov','Official OpenGov status is '+status,fields)
        if (status==='open' && future(match.proposalDeadline,now)) return result('open','OpenGov','Exact OpenGov project ID, open status and response deadline confirmed.',fields)
        return result('unverified','OpenGov','Official OpenGov status or response deadline is incomplete.',fields)
      }
      return result('unverified','OpenGov','Exact project ID not found within bounded official OpenGov search.')
    }
    if (target.platform === 'bonfire') {
      const args = {org:target.org,limit:200,offset:0}
      const response = lookups.bonfire
        ? await bounded(()=>lookups.bonfire!(args))
        : await bounded(()=>searchOpportunities(args))
      const data = response.data as {opportunities: BonRecord[]}
      const key = pathKey(candidate.pageValidation?.finalUrl || candidate.url)
      const hit = data.opportunities.find(item=>item.link && pathKey(item.link) === key)
      if (!hit) return result('unverified','Bonfire','No exact URL match in official live Bonfire RSS; not confirmed open.')
      const fields={sourceUrl:hit.link || candidate.url,deadline:iso(hit.closeDate),title:hit.name || undefined,solicitationNumber:hit.referenceNumber || undefined}
      if (hit.closeDate && !future(hit.closeDate,now)) return result('closed','Bonfire','Official feed shows a past deadline.',fields)
      return result('open','Bonfire','Exact opportunity URL is present in the official currently-open Bonfire feed.',fields)
    }
    const lookup = lookups.sam || ((id:string)=>samClient.getOpportunity(id))
    const notice = await bounded(()=>lookup(target.id))
    if (!notice || notice.noticeId.replace(/-/g,'').toLowerCase()!==target.id) return result('unverified','SAM.gov','Exact SAM.gov notice ID was not confirmed.')
    const fields={sourceUrl:notice.uiLink || candidate.url,buyer:notice.fullParentPathName,solicitationNumber:notice.solicitationNumber,title:notice.title,deadline:iso(notice.responseDeadLine)}
    if (notice.active==='No' || notice.type==='a' || (notice.responseDeadLine && !future(notice.responseDeadLine,now))) return result('closed','SAM.gov','Official notice inactive, awarded or past deadline.',fields)
    if (notice.active==='Yes' && (notice.type==='o' || notice.type==='k') && future(notice.responseDeadLine,now)) return result('open','SAM.gov','Exact active SAM.gov solicitation or combined notice with future response deadline confirmed.',fields)
    return result('unverified','SAM.gov','Official SAM.gov active status or deadline is incomplete.',fields)
  } catch {
    const source=target.platform==='sam'?'SAM.gov':target.platform==='bonfire'?'Bonfire':'OpenGov'
    return result('unverified',source,'Official source failed, timed out or changed format; unverified rather than guessed.')
  }
}
export async function gateOfficialOpportunities(rows: ScrapedResult[], lookups:OfficialLookups={}, now=new Date()):Promise<OfficialGateResult> {
  const checks=await Promise.all(rows.slice(0,MAX_LOOKUPS).map(row=>verifyOfficialOpportunity(row,lookups,now)))
  const verified:ScrapedResult[]=[],review:ScrapedResult[]=[],closed:ScrapedResult[]=[]
  for (let i=0;i<rows.length;i++) {
    const row=rows[i] as Candidate
    const proof=checks[i] || result('unverified','unsupported','Source-verification budget exhausted; requires review.')
    if(proof.verdict==='open') {
      verified.push({
        ...row, authoritativeVerification:proof,
        rfpIntelligence:row.rfpIntelligence ? {
          ...row.rfpIntelligence,
          ...(proof.buyer?{organization:proof.buyer}:{}),
          ...(proof.solicitationNumber?{solicitationNumber:proof.solicitationNumber}:{}),
          ...(proof.deadline?{dueDate:proof.deadline}:{}),
          ...(proof.title?{title:proof.title}:{})
        }:undefined
      } as ScrapedResult)
    } else {
      const isClosed=proof.verdict==='closed'
      const updated={
        ...row,authoritativeVerification:proof,
        bucket:isClosed?'expired':'uncertain',
        validation:row.validation?{...row.validation,status:isClosed?'rejected':'uncertain',reason:proof.reason}:undefined,
        canonicalDecision:{...(row.canonicalDecision || {}),decision:isClosed?'REJECT':'REVIEW',reason:proof.reason},
      } as ScrapedResult
      ;(isClosed?closed:review).push(updated)
    }
  }
  return {verified,review,closed,diagnostics:{
    checked:checks.length,open:verified.length,closed:closed.length,review:review.length,
    unsupported:checks.filter(x=>x.source==='unsupported').length,
    limited:Math.max(0,rows.length-checks.length)
  }}
}
