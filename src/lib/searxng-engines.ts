export const SEARXNG_WEB_ENGINES = [
  'google cse',
  'brave',
  'duckduckgo',
  'startpage',
  'bing',
  'qwant',
  'mojeek',
  'yahoo',
] as const

export type SearXNGWebEngine = typeof SEARXNG_WEB_ENGINES[number]

const ENGINE_LABELS: Record<SearXNGWebEngine, string> = {
  'google cse': 'Google CSE',
  brave: 'Brave',
  duckduckgo: 'DuckDuckGo',
  startpage: 'Startpage',
  bing: 'Bing',
  qwant: 'Qwant',
  mojeek: 'Mojeek',
  yahoo: 'Yahoo',
}

export function searxngEngineLabel(engine: string): string {
  const normalized = engine.trim().toLowerCase() as SearXNGWebEngine
  return ENGINE_LABELS[normalized] || engine
}
