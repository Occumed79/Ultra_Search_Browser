"use client";

import { useState } from "react";
import { Settings as SettingsIcon, Moon, Sun, Monitor, Globe, Zap, Keyboard, Cpu, Database } from "lucide-react";
import { Switch } from "../../components/ui/switch";
import { useTheme } from "next-themes";
import { useLocalStorage } from "../../hooks/use-local-storage";
import { UserSettings, SearchSource } from "../../types/search";
import { DEFAULT_USER_SETTINGS, SEARCH_SOURCE_OPTIONS, normalizeUserSettings } from "../../lib/search-settings";
import { FEATURE_CAPABILITIES, type FeatureStatus } from "../../lib/feature-capabilities";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [storedSettings, setSettings] = useLocalStorage<UserSettings>("user-settings", DEFAULT_USER_SETTINGS);
  const settings = normalizeUserSettings(storedSettings);
  const [saved, setSaved] = useState(false);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => normalizeUserSettings({ ...normalizeUserSettings(prev), [key]: value }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleSource = (source: SearchSource) => {
    setSettings((prev) => {
      const normalized = normalizeUserSettings(prev);
      if (normalized.defaultSources.includes(source) && normalized.defaultSources.length === 1) return normalized;
      const sources = normalized.defaultSources.includes(source)
        ? normalized.defaultSources.filter((s) => s !== source)
        : [...normalized.defaultSources, source];
      return normalizeUserSettings({ ...normalized, defaultSources: sources });
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen relative">
      <div className="liquid-bg">
        <div className="aurora-1" />
        <div className="aurora-2" />
        <div className="aurora-3" />
        <div className="glass-bubble bubble-1" />
        <div className="glass-bubble bubble-2" />
        <div className="glass-bubble bubble-3" />
      </div>

      <main className="relative z-10 container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="h-6 w-6 text-teal-300/80" />
          <h1 className="text-2xl font-bold text-white/90">Settings</h1>
          {saved && (
            <span className="text-sm text-emerald-300/80 animate-in fade-in">
              Saved!
            </span>
          )}
        </div>

        <div className="space-y-5">
          {/* Appearance */}
          <div className="glass-surface rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Monitor className="h-5 w-5 text-white/60" />
              <h2 className="text-[15px] font-semibold text-white/80">Appearance</h2>
            </div>
            <div className="space-y-3">
              <label className="text-sm text-white/60 block">Theme</label>
              <div className="flex gap-2">
                {[
                  { value: "light", icon: Sun, label: "Light" },
                  { value: "dark", icon: Moon, label: "Dark" },
                  { value: "system", icon: Monitor, label: "System" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTheme(option.value);
                      updateSetting("theme", option.value as UserSettings["theme"]);
                    }}
                    className={`flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg border transition-all ${
                      theme === option.value
                        ? 'bg-white/10 border-white/20 text-white/90'
                        : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/[0.07]'
                    }`}
                  >
                    <option.icon className="h-4 w-4" />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sources */}
          <div className="glass-surface rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-5 w-5 text-white/60" />
              <h2 className="text-[15px] font-semibold text-white/80">Default Sources</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {SEARCH_SOURCE_OPTIONS.map((source) => (
                <button
                  key={source.value}
                  onClick={() => toggleSource(source.value)}
                  className={`text-[12px] px-3 py-1.5 rounded-full border transition-all ${
                    settings.defaultSources.includes(source.value)
                      ? 'bg-white/10 border-white/20 text-white/90'
                      : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/[0.07]'
                  }`}
                >
                  {source.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
              <div>
                <p className="text-[13px] font-medium text-white/80">Results per search</p>
                <p className="text-[12px] text-white/35">Limit the ranked result set returned by the server</p>
              </div>
              <select
                value={settings.resultsPerPage}
                onChange={(event) => updateSetting("resultsPerPage", Number(event.target.value))}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white/70"
              >
                {[10, 20, 40, 60].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </div>
          </div>

          {/* Search Behavior */}
          <div className="glass-surface rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-5 w-5 text-white/60" />
              <h2 className="text-[15px] font-semibold text-white/80">Search Behavior</h2>
            </div>
            <div className="space-y-4">
              {[
                { key: 'autoSummarize', label: 'Auto-summarize', desc: 'Build a summary grounded in returned result titles and domains' },
                { key: 'safeSearch', label: 'Safe Search', desc: 'Filter out explicit content' },
                { key: 'openInNewTab', label: 'Open in New Tab', desc: 'Open result links in a new tab' },
                { key: 'showFavicons', label: 'Show Favicons', desc: 'Display website icons in results' },
                { key: 'showDescriptions', label: 'Show Descriptions', desc: 'Display result descriptions' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-white/80">{item.label}</p>
                    <p className="text-[12px] text-white/35">{item.desc}</p>
                  </div>
                  <Switch
                    checked={settings[item.key as keyof UserSettings] as boolean}
                    onCheckedChange={(v) => updateSetting(item.key as keyof UserSettings, v)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Keyboard */}
          <div className="glass-surface rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Keyboard className="h-5 w-5 text-white/60" />
              <h2 className="text-[15px] font-semibold text-white/80">Keyboard Shortcuts</h2>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-white/80">Enable Shortcuts</p>
                <p className="text-[12px] text-white/35">Use keyboard shortcuts for faster navigation</p>
              </div>
              <Switch
                checked={settings.keyboardShortcuts}
                onCheckedChange={(v) => updateSetting("keyboardShortcuts", v)}
              />
            </div>
          </div>

          {/* Advanced Features */}
          <div className="glass-surface rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="h-5 w-5 text-white/60" />
              <h2 className="text-[15px] font-semibold text-white/80">Advanced Features</h2>
            </div>
            <div className="space-y-3">
              {FEATURE_CAPABILITIES.map((feature) => (
                <div key={feature.id} className="flex items-start justify-between gap-4 p-3 rounded-lg border border-white/5 bg-white/[0.03]">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-[13px] text-white/80">{feature.label}</p>
                      <StatusBadge status={feature.status} />
                    </div>
                    <p className="text-[11px] text-white/35">{feature.description}</p>
                    {feature.notes && (
                      <p className="text-[11px] text-white/25 mt-1 italic">{feature.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="pt-4 mt-4 border-t border-white/5">
              <p className="text-[13px] font-medium text-white/80 mb-2">Procurement Search Diagnostics</p>
              <p className="text-[11px] text-white/35 mb-3">
                Procurement search uses web search with query expansion, PDF extraction, and ranking boosts. Diagnostics are logged to console during searches.
              </p>
              <div className="grid grid-cols-1 gap-2 text-[11px]">
                {[
                  { color: 'bg-blue-400', text: 'Query Expansion: RFP, RFQ, bid, solicitation, site:.gov, site:.us, PDF' },
                  { color: 'bg-emerald-400', text: 'PDF Extraction: Automatic for .gov/.us and PDF URLs' },
                  { color: 'bg-purple-400', text: 'Ranking Boosts: .gov domains, procurement terms, occupational health' },
                  { color: 'bg-orange-400', text: 'Intelligence: Procurement, pricing, provider extraction' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${item.color}`}></div>
                    <span className="text-white/35">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Database Configuration */}
          <div className="glass-surface rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Database className="h-5 w-5 text-white/60" />
              <h2 className="text-[15px] font-semibold text-white/80">Database Configuration</h2>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[13px] font-medium text-white/80 mb-2">DATABASE_URL (Server-Side Only)</p>
                <p className="text-[11px] text-white/35 mb-3">
                  PostgreSQL connection string for pgvector integration. This must be configured as an environment variable on your deployment platform (e.g., Render, Vercel). The browser never sees the raw connection string.
                </p>
                <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                  <p className="text-[11px] text-white/35">
                    <strong className="text-white/60">Configuration:</strong> Set <code className="bg-white/5 px-1 py-0.5 rounded text-[10px]">DATABASE_URL</code> in your deployment environment variables.
                  </p>
                  <p className="text-[11px] text-white/35 mt-2">
                    <strong className="text-white/60">Example:</strong> <code className="bg-white/5 px-1 py-0.5 rounded text-[10px]">postgresql://user:password@host:port/database</code>
                  </p>
                </div>
                <p className="text-[11px] text-white/25 mt-2">
                  If DATABASE_URL is not configured, the app uses local in-memory vector storage only.
                </p>
              </div>
              <div className="pt-4 border-t border-white/5">
                <p className="text-[13px] font-medium text-white/80 mb-2">pgvector Capabilities</p>
                <p className="text-[11px] text-white/35 mb-3">
                  When DATABASE_URL is configured, the app automatically initializes the pgvector extension and schema on first use.
                </p>
                <div className="grid grid-cols-1 gap-2 text-[11px]">
                  {[
                    'Automatic schema initialization',
                    'Vector similarity search with cosine distance',
                    'Persistent document storage',
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                      <span className="text-white/35">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: FeatureStatus }) {
  const styles: Record<FeatureStatus, string> = {
    active: 'bg-emerald-500/15 text-emerald-300/80 border-emerald-500/20',
    experimental: 'bg-teal-500/15 text-teal-300/80 border-teal-500/20',
    scaffold: 'bg-white/5 text-white/40 border-white/10',
    planned: 'bg-white/5 text-white/40 border-white/10',
    blocked: 'bg-red-500/15 text-red-300/80 border-red-500/20',
  };
  const labels: Record<FeatureStatus, string> = {
    active: 'Active', experimental: 'Experimental', scaffold: 'Scaffold',
    planned: 'Planned', blocked: 'Blocked',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
