// ─── ANTI-SPAM HEURISTICS ───
// Rule-based scoring to downrank low-quality content

// Known tracker domains (partial list)
const TRACKER_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.com/tr',
  'pixel.facebook.com',
  'connect.facebook.net',
  'analytics.twitter.com',
  't.co',
  'analytics.yahoo.com',
  'pixel.quantserve.com',
  'scorecardresearch.com',
  'c.amazon-adsystem.com',
  'ad.doubleclick.net',
  'adsystem.google.com',
  'pagead2.googlesyndication.com',
]

// Known affiliate patterns
const AFFILIATE_PATTERNS = [
  /ref=/i,
  /affiliate/i,
  /utm_source=/i,
  /utm_medium=/i,
  /utm_campaign=/i,
  /aff_id=/i,
  /affiliate_id=/i,
  /partner=/i,
  /referral/i,
  /click\.track/i,
  /tracking/i,
]

// Known AI slop domains (user-reportable, starting with common ones)
const AI_SLOP_DOMAINS = [
  'medium.com', // Often low-quality AI content
  'substack.com', // Can be mixed quality
]

// Known spammy TLD patterns
const SPAMMY_TLDS = [
  '.xyz',
  '.top',
  '.zip',
  '.mov',
  '.mp4',
]

export interface SpamScore {
  score: number
  reasons: string[]
}

/**
 * Calculate spam penalty for a URL
 * Returns a score where higher = more spammy
 */
export function calculateSpamPenalty(url: string): SpamScore {
  let score = 0
  const reasons: string[] = []

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // Check for tracker domains in URL
    for (const tracker of TRACKER_DOMAINS) {
      if (hostname.includes(tracker) || url.includes(tracker)) {
        score += 0.5
        reasons.push('tracker detected')
        break
      }
    }

    // Check for affiliate patterns
    for (const pattern of AFFILIATE_PATTERNS) {
      if (pattern.test(url)) {
        score += 1
        reasons.push('affiliate link detected')
        break
      }
    }

    // Check for AI slop domains
    for (const slopDomain of AI_SLOP_DOMAINS) {
      if (hostname.includes(slopDomain)) {
        score += 2
        reasons.push('potential AI slop domain')
        break
      }
    }

    // Check for spammy TLDs
    for (const tld of SPAMMY_TLDS) {
      if (hostname.endsWith(tld)) {
        score += 1
        reasons.push('spammy TLD')
        break
      }
    }

    // Check for excessive query parameters (often tracking)
    const params = urlObj.searchParams
    if (params.size > 5) {
      score += 0.5
      reasons.push('excessive tracking parameters')
    }

    // Check for very long URLs (often spam)
    if (url.length > 200) {
      score += 0.5
      reasons.push('suspiciously long URL')
    }

  } catch {
    // Invalid URL, penalize heavily
    score += 3
    reasons.push('invalid URL')
  }

  return { score, reasons }
}

/**
 * Calculate spam penalty for page content
 */
export function calculateContentSpamPenalty(content: string): SpamScore {
  let score = 0
  const reasons: string[] = []

  const lowerContent = content.toLowerCase()

  // Check for excessive repetition (boilerplate)
  const words = lowerContent.split(/\s+/)
  const uniqueWords = new Set(words)
  if (words.length > 0 && uniqueWords.size / words.length < 0.3) {
    score += 1
    reasons.push('low content uniqueness')
  }

  // Check for excessive keyword stuffing
  const keywordPatterns = [
    /buy now/i,
    /click here/i,
    /limited time/i,
    /act now/i,
    /don't miss/i,
    /exclusive deal/i,
  ]
  let keywordCount = 0
  for (const pattern of keywordPatterns) {
    const matches = content.match(pattern)
    if (matches) keywordCount += matches.length
  }
  if (keywordCount > 3) {
    score += 1
    reasons.push('keyword stuffing detected')
  }

  // Check for very short content
  if (content.length < 100) {
    score += 0.5
    reasons.push('very short content')
  }

  return { score, reasons }
}

/**
 * Calculate domain trust score based on domain age and authority
 * This is a simplified version - in production you'd use a real domain authority API
 */
export function calculateDomainTrust(hostname: string): number {
  // Simplified trust scoring
  // Higher = more trustworthy
  let trust = 0.5 // baseline

  // Boost for well-known domains
  const trustedDomains = [
    'wikipedia.org',
    'github.com',
    'stackoverflow.com',
    'reddit.com',
    '.gov',
    '.edu',
    '.org',
  ]

  for (const trusted of trustedDomains) {
    if (hostname.includes(trusted)) {
      trust += 0.3
      break
    }
  }

  // Penalize for new-looking domains (simplified)
  // In production, check actual domain age via WHOIS
  const numericDomains = /^\d+\./.test(hostname)
  if (numericDomains) {
    trust -= 0.2
  }

  return Math.max(0, Math.min(1, trust))
}

/**
 * Combined spam score for a search result
 */
export function calculateCombinedSpamScore(
  url: string,
  content?: string
): SpamScore {
  const urlPenalty = calculateSpamPenalty(url)
  let score = urlPenalty.score
  const reasons = [...urlPenalty.reasons]

  if (content) {
    const contentPenalty = calculateContentSpamPenalty(content)
    score += contentPenalty.score
    reasons.push(...contentPenalty.reasons)
  }

  // Apply domain trust as a bonus (reduces spam score)
  try {
    const hostname = new URL(url).hostname
    const trust = calculateDomainTrust(hostname)
    score *= (1 - trust * 0.5) // Trust reduces spam score by up to 50%
  } catch {
    // Invalid URL, keep score as is
  }

  return { score, reasons }
}

/**
 * Adjust result score based on spam penalty
 * Returns the adjusted score (should be lower for spammy results)
 */
export function applySpamPenalty(originalScore: number, spamScore: number): number {
  // Exponential penalty: spamScore of 1 cuts score in half, spamScore of 2 cuts to 25%
  const penalty = Math.pow(0.5, spamScore)
  return originalScore * penalty
}
