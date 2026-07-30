import type { RetrievalTask } from './search-planner'
import type { LiveSearchSource } from './search-settings'

const AUTOMATIC_BROWSER_FALLBACK_SOURCES = new Set<LiveSearchSource>([
  'bing',
  'duckduckgo',
  'mojeek',
])

export function selectAutomaticBrowserFallbackTasks(
  tasks: RetrievalTask[],
  enabled: boolean
): RetrievalTask[] {
  if (!enabled) return []
  const selectedSources = new Set<LiveSearchSource>()
  return tasks.filter(task => {
    if (task.purpose !== 'broad') return false
    if (!AUTOMATIC_BROWSER_FALLBACK_SOURCES.has(task.source)) return false
    if (selectedSources.has(task.source)) return false
    selectedSources.add(task.source)
    return true
  }).slice(0, AUTOMATIC_BROWSER_FALLBACK_SOURCES.size)
}
