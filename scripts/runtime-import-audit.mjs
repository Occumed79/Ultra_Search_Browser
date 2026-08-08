import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const srcRoot = path.join(root, 'src')
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const ENTRY_BASENAMES = new Set([
  'page.ts', 'page.tsx', 'route.ts', 'route.tsx', 'layout.ts', 'layout.tsx',
  'loading.ts', 'loading.tsx', 'error.ts', 'error.tsx', 'not-found.ts', 'not-found.tsx',
  'template.ts', 'template.tsx', 'default.ts', 'default.tsx',
])
const ROOT_ENTRYPOINTS = ['instrumentation.ts', 'instrumentation.tsx', 'middleware.ts', 'middleware.tsx']
const NON_RUNTIME_ALLOWLIST = [/\.d\.ts$/]

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) files.push(full)
  }
  return files
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function fileCandidate(absolute) {
  const candidates = [
    absolute,
    ...SOURCE_EXTENSIONS.map(extension => `${absolute}${extension}`),
    ...SOURCE_EXTENSIONS.map(extension => path.join(absolute, `index${extension}`)),
  ]
  return candidates.find(candidate => {
    try {
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  }) || null
}

function resolveImport(fromFile, specifier) {
  if (specifier.startsWith('.')) return fileCandidate(path.resolve(path.dirname(fromFile), specifier))
  if (specifier.startsWith('@/')) return fileCandidate(path.join(srcRoot, specifier.slice(2)))
  return null
}

function isLocalSpecifier(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('@/')
}

function importsFor(file) {
  const source = readFileSync(file, 'utf8')
  const specifiers = new Set()
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1])
  }
  return [...specifiers]
}

const allFiles = walk(srcRoot)
const allSet = new Set(allFiles.map(file => path.resolve(file)))
const entries = allFiles.filter(file => {
  const rel = relative(file)
  if (rel.startsWith('src/app/') && ENTRY_BASENAMES.has(path.basename(file))) return true
  return ROOT_ENTRYPOINTS.includes(rel.replace(/^src\//, ''))
})

const reachable = new Set()
const queue = [...entries]
const unresolvedLocalImports = []

while (queue.length) {
  const file = path.resolve(queue.shift())
  if (reachable.has(file) || !allSet.has(file)) continue
  reachable.add(file)
  for (const specifier of importsFor(file)) {
    if (!isLocalSpecifier(specifier)) continue
    const resolved = resolveImport(file, specifier)
    if (!resolved) {
      unresolvedLocalImports.push({ from: relative(file), specifier })
      continue
    }
    if (!reachable.has(path.resolve(resolved))) queue.push(resolved)
  }
}

const unreachable = allFiles
  .filter(file => !reachable.has(path.resolve(file)))
  .map(relative)
  .filter(file => !NON_RUNTIME_ALLOWLIST.some(pattern => pattern.test(file)))
  .sort()

const grouped = Object.fromEntries(['src/lib/', 'src/hooks/', 'src/components/', 'src/app/'].map(prefix => [
  prefix.replace(/^src\//, '').replace(/\/$/, ''),
  unreachable.filter(file => file.startsWith(prefix)),
]))

const report = {
  generatedAt: new Date().toISOString(),
  sourceFiles: allFiles.length,
  runtimeEntrypoints: entries.map(relative).sort(),
  reachableFiles: reachable.size,
  unreachableFiles: unreachable.length,
  unreachable,
  grouped,
  unresolvedLocalImports,
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  console.log(`[runtime-import-audit] source=${report.sourceFiles} entrypoints=${report.runtimeEntrypoints.length} reachable=${report.reachableFiles} unreachable=${report.unreachableFiles}`)
  if (unresolvedLocalImports.length) {
    console.log('\nUnresolved local imports:')
    for (const item of unresolvedLocalImports) console.log(`  ${item.from} -> ${item.specifier}`)
  }
  if (unreachable.length) {
    console.log('\nRuntime-unreachable source files:')
    for (const file of unreachable) console.log(`  ${file}`)
  }
}

if (process.env.RUNTIME_IMPORT_AUDIT_STRICT === '1' && (unresolvedLocalImports.length || unreachable.length)) {
  process.exitCode = 1
}
