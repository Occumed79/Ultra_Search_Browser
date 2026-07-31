'use client'

import { useEffect, useState } from 'react'

export type OpportunityStage = 'new' | 'reviewing' | 'pursue' | 'decline' | 'submitted' | 'awarded' | 'lost' | 'cancelled'

interface WorkspaceRecord {
  stage: OpportunityStage
  notes: string
  updatedAt: string
}

interface OpportunityWorkspaceProps {
  opportunityKey: string
  title: string
}

const STAGES: Array<{ value: OpportunityStage; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'pursue', label: 'Pursue' },
  { value: 'decline', label: 'Decline' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'lost', label: 'Lost' },
  { value: 'cancelled', label: 'Cancelled' },
]

function storageKey(key: string) {
  return `rfp-workspace:${key}`
}

export function OpportunityWorkspace({ opportunityKey, title }: OpportunityWorkspaceProps) {
  const [record, setRecord] = useState<WorkspaceRecord>({ stage: 'new', notes: '', updatedAt: '' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey(opportunityKey))
      if (stored) setRecord(JSON.parse(stored) as WorkspaceRecord)
    } catch {
      // Local workspace is optional.
    }
  }, [opportunityKey])

  function save(next: WorkspaceRecord) {
    setRecord(next)
    try {
      localStorage.setItem(storageKey(opportunityKey), JSON.stringify(next))
    } catch {
      // Keep the in-memory state when browser storage is unavailable.
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="rounded-md border border-teal-300/15 bg-teal-300/[0.05] px-2.5 py-1 text-[10px] text-teal-100/70 hover:bg-teal-300/[0.09]"
      >
        {STAGES.find(stage => stage.value === record.stage)?.label || 'Workspace'}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-40 w-72 rounded-xl border border-white/10 bg-[#0b1522]/98 p-3 shadow-2xl backdrop-blur-xl">
          <p className="line-clamp-2 text-[11px] font-medium text-white/75">{title}</p>
          <label className="mt-3 block text-[10px] text-white/40">
            Pursuit stage
            <select
              value={record.stage}
              onChange={event => save({ ...record, stage: event.target.value as OpportunityStage, updatedAt: new Date().toISOString() })}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white/75"
            >
              {STAGES.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-[10px] text-white/40">
            Internal notes
            <textarea
              value={record.notes}
              onChange={event => setRecord(current => ({ ...current, notes: event.target.value }))}
              onBlur={() => save({ ...record, updatedAt: new Date().toISOString() })}
              rows={4}
              placeholder="Owner, next action, questions deadline, blockers..."
              className="mt-1 w-full resize-none rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white/75 outline-none"
            />
          </label>
          <div className="mt-2 flex justify-between text-[9px] text-white/25">
            <span>{record.updatedAt ? `Saved ${new Date(record.updatedAt).toLocaleString()}` : 'Not yet saved'}</span>
            <button type="button" onClick={() => setOpen(false)} className="text-white/45 hover:text-white/70">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
