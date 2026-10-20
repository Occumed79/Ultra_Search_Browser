import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verifyOfficialOpportunity, gateOfficialOpportunities } from '../src/lib/authoritative-procurement'
import type { ScrapedResult } from '../src/types/search'
import type { SamOpportunity } from '../src/vendor/cliwant/sam-gov/types'

const now = new Date('2026-10-20T05:00:00Z')
const base: ScrapedResult = {
  title: 'Employee physical examinations and drug testing RFP',
  url: 'https://www.highergov.com/s/contract-opportunity/mn-employment-physical-examinations-and-dru-63688734',
  description: 'Third-party listing, incorrectly reports June 30 2027 as open deadline.',
  domain: 'highergov.com', source: 'Keenable', rank: 1, score: 70, bucket: 'valid',
  validation: {status:'valid',relevance:.7,reason:'SHOW score 70',matchedConcepts:[],mode:'local-rules'},
  pageValidation: {
    checkedAt:now.toISOString(),requestedUrl:'https://www.highergov.com/s/contract-opportunity/mn-employment-physical-examinations-and-dru-63688734',
    finalUrl:'https://www.highergov.com/s/contract-opportunity/mn-employment-physical-examinations-and-dru-63688734',
    availability:'reachable',reason:'Page contains content',evidence:['future 2027'],extractedTextLength:1200,cached:false,
    lifecycle:{status:'open',reason:'future date',confidence:.92,dates:[]}
  },
}
test('Minnesota DPS awarded listing cannot be green-verified by third-party HigherGov future date', async()=>{
  const x=await verifyOfficialOpportunity(base,{},now)
  assert.equal(x.verdict,'unverified')
  assert.equal(x.source,'unsupported')
  const output=await gateOfficialOpportunities([base],{},now)
  assert.equal(output.verified.length,0)
  assert.equal(output.review.length,1)
  assert.equal(output.review[0].bucket,'uncertain')
  assert.equal(output.review[0].validation?.status,'uncertain')
})
test('OpenGov exact project ID open with future proposalDeadline can be verified and corrected', async()=>{
  const candidate={...base,url:'https://procurement.opengov.com/portal/cityofexample/projects/34567',pageValidation:{...base.pageValidation!,finalUrl:'https://procurement.opengov.com/portal/cityofexample/projects/34567'}}
  const proof=await verifyOfficialOpportunity(candidate,{
    opengov:async()=>({data:{solicitations:[{id:34567,title:'RFP Clinic Examinations',department:'Example Public Health Agency',status:'open',proposalDeadline:'2099-10-20T12:00:00Z',solicitationNumber:'E-26-5',link:candidate.url}]},meta:{pagination:{hasMore:false}}})
  },now)
  assert.equal(proof.verdict,'open')
  const result=await gateOfficialOpportunities([candidate],{
    opengov:async()=>({data:{solicitations:[{id:34567,status:'open',department:'Example Public Health Agency',proposalDeadline:'2099-10-20T12:00:00Z',solicitationNumber:'E-26-5'}]},meta:{pagination:{hasMore:false}}})
  },now)
  assert.equal(result.verified.length,1)
  assert.equal(result.review.length,0)
  assert.equal(result.verified[0].authoritativeVerification?.source,'OpenGov')
})
test('OpenGov award, evaluation, closed and unknown states cannot pass based on a future deadline', async()=>{
  const candidate={...base,url:'https://procurement.opengov.com/portal/cityofexample/projects/34567',pageValidation:undefined}
  for (const status of ['awarded','evaluation','closed','cancelled','pending']) {
    const response=await verifyOfficialOpportunity(candidate,{opengov:async()=>({data:{solicitations:[{id:34567,status,proposalDeadline:'2099-11-20'}]}})},now)
    assert.equal(response.verdict,status==='pending'?'unverified':'closed')
  }
})
test('OpenGov cannot borrow another project matching title or deadline',async()=>{
  const candidate={...base,url:'https://procurement.opengov.com/portal/cityofexample/projects/34567',pageValidation:undefined}
  const response=await verifyOfficialOpportunity(candidate,{opengov:async()=>({data:{solicitations:[{id:99999,title:candidate.title,status:'open',proposalDeadline:'2099-11-20'}]},meta:{pagination:{hasMore:false}}})},now)
  assert.equal(response.verdict,'unverified')
})
test('Bonfire open RSS must contain the exact opportunity URL',async()=>{
  const candidate={...base,url:'https://examplecounty.bonfirehub.com/opportunities/80501',pageValidation:undefined}
  const yes=await verifyOfficialOpportunity(candidate,{bonfire:async()=>({data:{opportunities:[
    {link:'https://examplecounty.bonfirehub.com/opportunities/80501',name:'Medical RFP',referenceNumber:'80-501'}
  ]}})},now)
  assert.equal(yes.verdict,'open')
  const no=await verifyOfficialOpportunity(candidate,{bonfire:async()=>({data:{opportunities:[
    {link:'https://examplecounty.bonfirehub.com/opportunities/other',name:candidate.title}
  ]}})},now)
  assert.equal(no.verdict,'unverified')
})
test('SAM.gov notice ID matching, inactive and award status override relevance',async()=>{
  const id='abcdef1234567890abcdef1234567890'
  const candidate={...base,url:'https://sam.gov/opp/'+id+'/view',pageValidation:undefined}
  const record:SamOpportunity={noticeId:id,title:'Clinic medical exam award',responseDeadLine:'2099-10-20',type:'o',active:'Yes'}
  const yes=await verifyOfficialOpportunity(candidate,{sam:async()=>record},now)
  assert.equal(yes.verdict,'open')
  for(const changed of [{...record,active:'No' as const},{...record,type:'a'}]){
    const no=await verifyOfficialOpportunity(candidate,{sam:async()=>changed},now)
    assert.equal(no.verdict,'closed')
  }
  assert.equal((await verifyOfficialOpportunity(candidate,{sam:async()=>({...record,noticeId:'1234567890abcdef1234567890abcdef'})},now)).verdict,'unverified')
})
test('unsupported Passaic city portal and Arvada file storage stay REVIEW rather than fabricated verification',async()=>{
  for(const url of ['https://www.cityofpassaic.com/bids.aspx?bidID=722','https://bqohpheioaljycjpwbjd.supabase.co/storage/v1/object/public/documents/unique/foo.pdf']){
    const proof=await verifyOfficialOpportunity({...base,url,pageValidation:undefined},{},now)
    assert.equal(proof.verdict,'unverified')
    assert.equal(proof.source,'unsupported')
  }
})
test('source outage never becomes open and source code is third-party, not a rewritten collector',async()=>{
  const url='https://procurement.opengov.com/portal/cityofexample/projects/34567'
  const proof=await verifyOfficialOpportunity({...base,url,pageValidation:undefined},{opengov:async()=>{throw Error('rate limit')}},now)
  assert.equal(proof.verdict,'unverified')
  const src=readFileSync(new URL('../src/app/api/search/validate/route.ts',import.meta.url),'utf8')
  assert.match(src,/gateOfficialOpportunities/)
  assert.match(src,/outcome\.buckets\.uncertain\.push/)
  const ui=readFileSync(new URL('../src/app/page.tsx',import.meta.url),'utf8')
  assert.match(ui,/authoritativeVerification\?\.verdict === 'open'/)
})
