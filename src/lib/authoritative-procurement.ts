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
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp >= now.getTime()
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
  if (!target) return result('unverified','unsupported','No supported issuing-portal record was identified. A search result or third-party listing cannot verify open status.')
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
    if (notice.active==='Yes' && future(notice.responseDeadLine,now)) return result('open','SAM.gov','Exact active SAM.gov notice with future deadline confirmed.',fields)
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
