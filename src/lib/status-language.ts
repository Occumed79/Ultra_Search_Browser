/** A future or negated status phrase is not evidence that the event happened. */
export function hasAssertedStatusPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\b${escaped}\\b`, 'gi')
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    const before = text.slice(Math.max(0, index - 90), index)
    const after = text.slice(index + match[0].length, index + match[0].length + 60)
    if (/\b(?:will|shall|would|may|might|could|must)\s+(?:\w+\s+){0,4}$/i.test(before)) continue
    if (/\b(?:not|never)\s+(?:\w+\s+){0,3}$/i.test(before)) continue
    if (/^\s+(?:will|shall|would|may|might|could)\b/i.test(after)) continue
    return true
  }
  return false
}
