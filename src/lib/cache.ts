// ─── SIMPLE IN-MEMORY CACHE ───
// SERVER-SIDE ONLY: This module must only be imported in server-side code
// NOTE: This cache is in-memory and resets on server restart (e.g., Render deployments)
// For production persistence, consider Redis or a similar solution

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class SimpleCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private defaultTTL: number

  constructor(defaultTTL: number = 5 * 60 * 1000) { // 5 minutes default
    this.defaultTTL = defaultTTL
  }

  set(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    })
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }

  get size(): number {
    return this.cache.size
  }
}

// ─── SIMPLE RATE LIMITER ───

class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private windowMs: number
  private maxRequests: number

  constructor(windowMs: number = 60000, maxRequests: number = 10) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  check(key: string): boolean {
    try {
      const now = Date.now()
      const timestamps = this.requests.get(key) || []
      
      // Remove timestamps outside the window
      const validTimestamps = timestamps.filter(t => now - t < this.windowMs)
      
      if (validTimestamps.length >= this.maxRequests) {
        return false // Rate limit exceeded
      }
      
      // Add current timestamp
      validTimestamps.push(now)
      this.requests.set(key, validTimestamps)
      
      return true
    } catch (err) {
      // If rate limiter fails, allow the request to proceed (fail-open)
      console.warn('Rate limiter check failed, allowing request:', err)
      return true
    }
  }

  reset(key: string): void {
    this.requests.delete(key)
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(t => now - t < this.windowMs)
      if (validTimestamps.length === 0) {
        this.requests.delete(key)
      } else {
        this.requests.set(key, validTimestamps)
      }
    }
  }
}

// Global cache instances
export const searchCache = new SimpleCache<any>(5 * 60 * 1000) // 5 minutes
export const scrapeCache = new SimpleCache<any>(10 * 60 * 1000) // 10 minutes

// Global rate limiter instances
export const searchRateLimiter = new RateLimiter(60000, 10) // 10 requests per minute
export const scrapeRateLimiter = new RateLimiter(60000, 5) // 5 scrapes per minute per domain

// Cleanup expired entries every 5 minutes
setInterval(() => {
  searchCache.cleanup()
  scrapeCache.cleanup()
  searchRateLimiter.cleanup()
  scrapeRateLimiter.cleanup()
}, 5 * 60 * 1000)
