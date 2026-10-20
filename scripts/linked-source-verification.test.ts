import test from 'node:test'
import assert from 'node:assert/strict'
import { officialSourceLinks, supportedOfficialRecordUrl } from '../src/lib/official-source-links'
import { verifyOfficialOpportunity, gateOfficialOpportunities } from '../src/lib/authoritative-procurement'
import type { ScrapedResult } from '../src/types/search'
import type { SamOpportunity } from '../src/vendor/cliwant/sam-gov/types'

const now=new Date('2026-10-20T17:00:00Z')
const samId='abcdef1234567890abcdef1234567890'
const thirdParty='https://www.highergov.com/contract-opportunity/medical-examinations-example'
const samUrl='https://sam.gov/opp/'+samId+'/view'
const base:ScrapedResult={
  title:'Occupational Medical Examinations and Audiometry',
  url:thirdParty,description:'Third-party listing',domain:'highergov.com',rank:1,source:'Keenable',score:87,
  bucket:'valid',validation:{status:'valid',relevance:.87,reason:'relevant',matchedConcepts:[],mode:'local-rules'},
  pageValidation:{
    checkedAt:now.toISOString(),requestedUrl:thirdParty,finalUrl:thirdParty,availability:'reachable',
    reason:'Read listing',evidence:[],extractedTextLength:400,cached:false,
    lifecycle:{status:'open',reason:'future date',confidence:.8,dates:[]}
  }
}
function ref(lines:Array<{url:string;text:string}>, candidate=base) {
  return {...candidate,pageValidation:{...candidate.pageValidation!, officialSourceLinks:lines}} as ScrapedResult
}
const notice:SamOpportunity={
  noticeId:samId,
  title:'Occupational Medical Examinations and Audiometry',
  solicitationNumber:'36C10-26-R-0101',
  fullParentPathName:'Department of Veterans Affairs',
  active:'Yes',type:'o',responseDeadLine:'2099-12-31'
}
function withIntelligence(candidate:ScrapedResult, id='36C10-26-R-0101') {
  return {...candidate, rfpIntelligence:{
    title:candidate.title, organization:'Department of Veterans Affairs',
    solicitationNumber:id
  }} as ScrapedResult
}
test('only explicit original-source hyperlinks are considered for corroboration',()=>{
  const urls=officialSourceLinks([
    {url:'https://sam.gov/opp/'+samId+'/view',text:'Official solicitation'},
    {url:'https://sam.gov/opp/'+samId+'/view',text:'Official solicitation'},
    {url:'https://procurement.opengov.com/portal/testcity/projects/1234',text:'More projects'},
    {url:'https://procurement.opengov.com/portal/testcity/projects/4567',text:'View original opportunity'},
    {url:'https://sam.gov/opp/'+samId+'/view',text:'Recommended similar item'},
    {url:'http://sam.gov/opp/'+samId+'/view',text:'Official notice'},
    {url:'https://sam.gov.evil.example/opp/'+samId+'/view',text:'Official notice'},
    {url:'https://sam.gov/opp/'+samId+'/view',text:'Official opportunity'},
  ],thirdParty)
  assert.equal(urls.length,2)
  assert.equal(urls[0].url,samUrl)
  assert.match(urls[1].url,/\/projects\/4567/)
  assert.equal(supportedOfficialRecordUrl('https://sam.gov.evil.example/opp/'+samId+'/view'),false)
  assert.equal(supportedOfficialRecordUrl('http://sam.gov/opp/'+samId+'/view'),false)
})
test('matching solicitation ID and title permits a direct linked SAM notice to be verified',async()=>{
  const c=withIntelligence(ref([{url:samUrl,text:'Official solicitation'}]))
  const result=await verifyOfficialOpportunity(c,{sam:async()=>notice},now)
  assert.equal(result.verdict,'open')
  assert.equal(result.source,'SAM.gov')
  assert.match(result.reason,/independent solicitation identity/)
  const gate=await gateOfficialOpportunities([c],{sam:async()=>notice},now)
  assert.equal(gate.verified.length,1)
  assert.equal(gate.review.length,0)
})
test('unrelated official notice cannot verify a third-party page just because it links to an open bid',async()=>{
  const original=ref([{url:samUrl,text:'Official notice'}])
  assert.equal((await verifyOfficialOpportunity(original,{sam:async()=>notice},now)).verdict,'unverified')
  const wrong=withIntelligence(original,'DIFFERENT-26-101')
  assert.equal((await verifyOfficialOpportunity(wrong,{sam:async()=>notice},now)).verdict,'unverified')
  const misleading={...notice,title:'Completely Different Uniform Supply Procurement'}
  assert.equal((await verifyOfficialOpportunity(withIntelligence(original),{sam:async()=>misleading},now)).verdict,'unverified')
})
test('source status CLOSED overrides third-party future date only when record identity is corroborated',async()=>{
  const c=withIntelligence(ref([{url:samUrl,text:'View original opportunity'}]))
  const closed={...notice,active:'No' as const}
  const checked=await gateOfficialOpportunities([c],{sam:async()=>closed},now)
  assert.equal(checked.verified.length,0)
  assert.equal(checked.closed.length,1)
  assert.equal(checked.closed[0].authoritativeVerification?.verdict,'closed')
})
test('SAM presolicitation and sources sought are not accepting bids just because active and future dated',async()=>{
  const c=withIntelligence(ref([{url:samUrl,text:'Official solicitation'}]))
  for (const type of ['p','r','s']) {
    const out=await verifyOfficialOpportunity(c,{sam:async()=>({...notice,type})},now)
    assert.equal(out.verdict,'unverified')
  }
  assert.equal((await verifyOfficialOpportunity(c,{sam:async()=>({...notice,type:'k'})},now)).verdict,'open')
})
test('calendar-date only deadline is valid through its UTC day, not falsely expired at midnight',async()=>{
  const c=withIntelligence(ref([{url:samUrl,text:'Official solicitation'}]))
  const d={...notice,responseDeadLine:'2026-10-20'}
  assert.equal((await verifyOfficialOpportunity(c,{sam:async()=>d},now)).verdict,'open')
  assert.equal((await verifyOfficialOpportunity(c,{sam:async()=>d},new Date('2026-10-21T03:00:00Z'))).verdict,'unverified')
})
test('unreachable official source does not validate a linked third-party listing',async()=>{
  const c=withIntelligence(ref([{url:samUrl,text:'Official solicitation'}]))
  assert.equal((await verifyOfficialOpportunity(c,{sam:async()=>{throw Error('source timeout')}},now)).verdict,'unverified')
})
