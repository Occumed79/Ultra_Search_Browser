/** Agency directories aggregate separate bids; their dates and scopes cannot verify one opportunity. */
export function isProcurementListingUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return /(?:^|\.)bidexpress\.com$/i.test(url.hostname)
      && /^\/businesses\/\d+\/(?:home)?\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}
