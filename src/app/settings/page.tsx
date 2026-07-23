'use client'

import {
  CheckCircle2,
  Cpu,
  Database,
  Globe,
  Keyboard,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Switch } from '../../components/ui/switch'
import { useLocalStorage } from '../../hooks/use-local-storage'
import type { SearchSource, UserSettings } from '../../types/search'
import {
  DEFAULT_USER_SETTINGS,
  SEARCH_SOURCE_OPTIONS,
  normalizeUserSettings,
} from '../../lib/search-settings'

type CapabilityKey = 'database' | 'searxng' | 'localEmbeddings' | 'ocr'
type Capabilities = Record<CapabilityKey, { configured: boolean; label: string }>
type BooleanSetting = 'autoSummarize' | 'safeSearch' | 'openInNewTab' | 'showFavicons' | 'showDescriptions'

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  google: 'Broad web coverage',
  bing: 'Independent web index',
  duckduckgo: 'Privacy-focused web results',
  searxng: 'Self-hosted metasearch source',
  memory: 'Previously indexed search memory',
}

const BEHAVIOR_OPTIONS: Array<{ key: BooleanSetting; label: string; description: string }> = [
  { key: 'autoSummarize', label: 'Search summary', description: 'Summarize the ranked results using their titles and domains' },
  { key: 'safeSearch', label: 'Safe Search', description: 'Filter explicit result metadata' },
  { key: 'openInNewTab', label: 'Open in new tab', description: 'Keep Ultra Search open when visiting a result' },
  { key: 'showFavicons', label: 'Show website icons', description: 'Display a small site icon beside each result' },
  { key: 'showDescriptions', label: 'Show descriptions', description: 'Display result snippets beneath titles' },
]

export default function SettingsPage() {
  const [storedSettings, setSettings] = useLocalStorage<UserSettings>('user-settings', DEFAULT_USER_SETTINGS)
  const settings = normalizeUserSettings(storedSettings)
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/capabilities', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Capability status unavailable')
        return (await response.json()) as Capabilities
      })
      .then(data => {
        if (mounted) setCapabilities(data)
      })
      .catch(() => {
        if (mounted) setCapabilities(null)
      })

    return () => {
      mounted = false
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
    }
  }, [])

  function markSaved() {
    setSaved(true)
    if (savedTimer.current) window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaved(false), 1800)
  }

  function updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    setSettings(previous => normalizeUserSettings({ ...normalizeUserSettings(previous), [key]: value }))
    markSaved()
  }

  function toggleSource(source: SearchSource) {
    if (source === 'searxng' && capabilities?.searxng.configured === false) return

    setSettings(previous => {
      const normalized = normalizeUserSettings(previous)
      if (normalized.defaultSources.includes(source) && normalized.defaultSources.length === 1) return normalized
      const defaultSources = normalized.defaultSources.includes(source)
        ? normalized.defaultSources.filter(item => item !== source)
        : [...normalized.defaultSources, source]
      return normalizeUserSettings({ ...normalized, defaultSources })
    })
    markSaved()
  }

  function resetSettings() {
    setSettings(DEFAULT_USER_SETTINGS)
    markSaved()
  }

  const runtimeItems = [
    { key: 'database' as const, label: 'Persistent storage', icon: Database },
    { key: 'searxng' as const, label: 'SearXNG', icon: Globe },
    { key: 'localEmbeddings' as const, label: 'Local embeddings', icon: Cpu },
    { key: 'ocr' as const, label: 'OCR', icon: ShieldCheck },
  ]

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="liquid-bg">
        <div className="aurora-1" />
        <div className="aurora-2" />
        <div className="aurora-3" />
        <div className="glass-bubble bubble-1" />
        <div className="glass-bubble bubble-2" />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-teal-200/65">
              <SettingsIcon className="h-3.5 w-3.5" /> Search preferences
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white/95">Settings</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/45">
              Control the sources, result density, and behaviors that actually affect search.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-200/75">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            <button className="glass-button text-[11px]" onClick={resetSettings}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <section className="glass-surface rounded-[22px] p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Globe className="h-5 w-5 text-white/60" />
              <div>
                <h2 className="text-[15px] font-semibold text-white/85">Search sources</h2>
                <p className="text-xs text-white/35">Only these selected sources run during a search.</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {SEARCH_SOURCE_OPTIONS.map(source => {
                const selected = settings.defaultSources.includes(source.value)
                const unavailable = source.value === 'searxng' && capabilities?.searxng.configured === false
                return (
                  <button
                    key={source.value}
                    disabled={unavailable}
                    onClick={() => toggleSource(source.value)}
                    className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-all ${
                      selected
                        ? 'border-teal-200/25 bg-teal-200/[0.08]'
                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.055]'
                    } ${unavailable ? 'cursor-not-allowed opacity-45' : ''}`}
                  >
                    <div>
                      <p className="text-[13px] font-medium text-white/80">{source.label}</p>
                      <p className="mt-0.5 text-[11px] text-white/35">{SOURCE_DESCRIPTIONS[source.value] ?? 'Search source'}</p>
                    </div>
                    <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${selected ? 'bg-teal-300 shadow-[0_0_12px_rgba(94,234,212,0.55)]' : 'bg-white/15'}`} />
                  </button>
                )
              })}
            </div>

            {capabilities?.searxng.configured === false && (
              <p className="mt-3 text-[11px] text-white/30">SearXNG is unavailable until the server has a SEARXNG_URL configured.</p>
            )}

            <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/8 pt-5">
              <div>
                <p className="text-[13px] font-medium text-white/80">Results per search</p>
                <p className="text-[11px] text-white/35">Limit the final ranked result set.</p>
              </div>
              <select
                value={settings.resultsPerPage}
                onChange={event => updateSetting('resultsPerPage', Number(event.target.value))}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white/70"
              >
                {[10, 20, 40, 60].map(count => <option key={count} value={count}>{count}</option>)}
              </select>
            </div>
          </section>

          <section className="glass-surface rounded-[22px] p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-white/60" />
              <div>
                <h2 className="text-[15px] font-semibold text-white/85">Search behavior</h2>
                <p className="text-xs text-white/35">Tune how results are filtered and displayed.</p>
              </div>
            </div>
            <div className="divide-y divide-white/8">
              {BEHAVIOR_OPTIONS.map(item => (
                <div key={item.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-[13px] font-medium text-white/80">{item.label}</p>
                    <p className="mt-0.5 text-[11px] text-white/35">{item.description}</p>
                  </div>
                  <Switch checked={settings[item.key]} onCheckedChange={value => updateSetting(item.key, value)} />
                </div>
              ))}
            </div>
          </section>

          <section className="glass-surface rounded-[22px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <Keyboard className="mt-0.5 h-5 w-5 text-white/60" />
                <div>
                  <h2 className="text-[15px] font-semibold text-white/85">Keyboard shortcut</h2>
                  <p className="mt-1 text-xs text-white/35">Use Command/Ctrl + K to focus the search box.</p>
                </div>
              </div>
              <Switch checked={settings.keyboardShortcuts} onCheckedChange={value => updateSetting('keyboardShortcuts', value)} />
            </div>
          </section>

          <section className="glass-surface rounded-[22px] p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Cpu className="h-5 w-5 text-white/60" />
              <div>
                <h2 className="text-[15px] font-semibold text-white/85">Deployment capabilities</h2>
                <p className="text-xs text-white/35">Live status from this running server—not a generic feature roadmap.</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {runtimeItems.map(item => {
                const capability = capabilities?.[item.key]
                const enabled = capability?.configured === true
                const Icon = item.icon
                return (
                  <div key={item.key} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${enabled ? 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200/75' : 'border-white/8 bg-white/[0.035] text-white/30'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-white/75">{item.label}</p>
                      <p className="truncate text-[10px] text-white/30">{capability?.label ?? 'Checking server status'}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] ${enabled ? 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200/70' : 'border-white/10 bg-white/[0.03] text-white/30'}`}>
                      {capabilities === null ? 'Unknown' : enabled ? 'On' : 'Off'}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
