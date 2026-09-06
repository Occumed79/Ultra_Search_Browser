const cursors = new Map<string, number>()

export interface ProviderKeySlot {
  envName: string
  value: string
}

export function configuredProviderKeys(
  envNames: string[],
  environment: NodeJS.ProcessEnv = process.env
): ProviderKeySlot[] {
  const seen = new Set<string>()
  const keys: ProviderKeySlot[] = []

  for (const envName of envNames) {
    const value = String(environment[envName] || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    keys.push({ envName, value })
  }

  return keys
}

export function providerKeyCount(
  envNames: string[],
  environment: NodeJS.ProcessEnv = process.env
): number {
  return configuredProviderKeys(envNames, environment).length
}

export function rotatingProviderKeys(
  poolName: string,
  envNames: string[],
  maxAttempts = 2,
  environment: NodeJS.ProcessEnv = process.env
): ProviderKeySlot[] {
  const keys = configuredProviderKeys(envNames, environment)
  if (keys.length === 0) return []

  const start = cursors.get(poolName) || 0
  cursors.set(poolName, (start + 1) % keys.length)

  const ordered = keys.map((_, index) => keys[(start + index) % keys.length])
  return ordered.slice(0, Math.max(1, Math.min(maxAttempts, ordered.length)))
}

export function resetProviderKeyPoolForTests(): void {
  cursors.clear()
}
