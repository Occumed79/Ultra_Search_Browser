import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const deadModules = new Set([
  'src/lib/automatic-browser-fallback.ts',
  'src/lib/brave-search-api.ts',
  'src/lib/feature-capabilities.ts',
  'src/lib/gemini-grounded-search.ts',
  'src/lib/managed-search.ts',
  'src/lib/occumed-supplemental-search.ts',
  'src/lib/procurement-api-sources.ts',
  'src/lib/procurement-browser-rescue-tasks.ts',
  'src/lib/procurement-rescue.ts',
  'src/lib/public-search-fallbacks.ts',
  'src/lib/resilient-search.ts',
  'src/lib/sam-gov-opportunities.ts',
  'src/lib/search-intent-routing.ts',
  'src/lib/search-orchestrator.ts',
  'src/lib/search-response-parsers.ts',
  'src/lib/tavily-search.ts',
])

function normalize(file) {
  return file.split(path.sep).join('/')
}

function sourceImports(file) {
  const source = readFileSync(file, 'utf8')
  const imports = []
  for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) imports.push(match[1])
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) imports.push(match[1])
  return imports
}

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`]) {
    if (existsSync(candidate)) return normalize(path.relative(root, candidate))
  }
  return null
}

const scriptDir = path.join(root, 'scripts')
const testFiles = []
for (const name of (await import('node:fs')).readdirSync(scriptDir)) {
  if (/\.test\.(?:ts|tsx|js|mjs)$/.test(name)) testFiles.push(path.join(scriptDir, name))
}

const orphanTests = []
const mixedTests = []
for (const testFile of testFiles) {
  const resolved = sourceImports(testFile)
    .map(specifier => resolveLocal(testFile, specifier))
    .filter(Boolean)
    .filter(file => file.startsWith('src/'))
  const deadRefs = resolved.filter(file => deadModules.has(file))
  if (!deadRefs.length) continue
  const liveRefs = resolved.filter(file => !deadModules.has(file))
  if (liveRefs.length) {
    mixedTests.push({ test: normalize(path.relative(root, testFile)), deadRefs, liveRefs })
  } else {
    orphanTests.push(normalize(path.relative(root, testFile)))
  }
}

if (mixedTests.length) {
  console.error('Refusing automatic purge because these tests mix dead and live runtime modules:')
  for (const item of mixedTests) console.error(JSON.stringify(item))
  process.exit(2)
}

for (const file of deadModules) {
  const absolute = path.join(root, file)
  if (existsSync(absolute)) rmSync(absolute)
}
for (const file of orphanTests) {
  const absolute = path.join(root, file)
  if (existsSync(absolute)) rmSync(absolute)
}

console.log(JSON.stringify({
  removedRuntimeModules: [...deadModules],
  removedOrphanTests: orphanTests,
  mixedTests,
}, null, 2))
