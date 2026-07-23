import test from 'node:test'
import assert from 'node:assert/strict'
import { rerankResults, scoreLexicalRelevance } from '../src/lib/semantic-search'

test('exact multi-concept results score above generic one-word matches', () => {
  const query = 'occupational health services Fresno'
  const exact = scoreLexicalRelevance(query, {
    title: 'Occupational Health Services in Fresno',
    text: 'Employer physicals and occupational medicine services in Fresno, California.',
    url: 'https://example.com/fresno-occupational-health',
  })
  const generic = scoreLexicalRelevance(query, {
    title: 'Health Services',
    text: 'General health information and wellness resources.',
    url: 'https://example.org/health',
  })

  assert.ok(exact > 0.9)
  assert.ok(generic < 0.4)
  assert.ok(exact > generic)
})

test('technical punctuation is normalized without confusing unrelated brands', () => {
  const query = 'Next.js route handler AbortSignal timeout'
  const technical = scoreLexicalRelevance(query, {
    title: 'Next.js Route Handlers',
    text: 'Use AbortSignal.timeout with fetch inside a route handler.',
    url: 'https://nextjs.org/docs/app/building-your-application/routing/route-handlers',
  })
  const retailer = scoreLexicalRelevance(query, {
    title: 'Next: Shop Clothing and Homeware',
    text: 'Fashion, furniture, and accessories from Next.',
    url: 'https://www.next.co.uk/',
  })

  assert.ok(technical > 0.8)
  assert.ok(retailer < 0.2)
})

test('reranking puts the strongest query match first', () => {
  const ranked = rerankResults('OSHA 1910.134 respirator fit testing', [
    {
      id: 'generic',
      title: 'Occupational Safety and Health Administration',
      text: 'The official OSHA homepage provides workplace safety information.',
      url: 'https://www.osha.gov/',
    },
    {
      id: 'specific',
      title: 'Respiratory Protection Standard 1910.134',
      text: 'OSHA requirements for respirator fit testing under 29 CFR 1910.134.',
      url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.134',
    },
  ], 2)

  assert.equal(ranked[0].id, 'specific')
  assert.ok(ranked[0].score > ranked[1].score)
})

test('common question words do not overpower meaningful concepts', () => {
  const relevant = scoreLexicalRelevance('what is the Bruce protocol for a treadmill stress test', {
    title: 'Bruce Protocol Treadmill Stress Test',
    text: 'Stages, speed, incline, heart rate, and interpretation.',
  })
  const irrelevant = scoreLexicalRelevance('what is the Bruce protocol for a treadmill stress test', {
    title: 'What Is a Treadmill?',
    text: 'A guide to home exercise equipment.',
  })

  assert.ok(relevant > irrelevant)
})
