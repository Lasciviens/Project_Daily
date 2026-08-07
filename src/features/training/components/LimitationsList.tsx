import { useState } from 'react'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import {
  useAthleteLimitations, useCreateLimitation, useUpdateLimitation, useDeleteLimitation,
} from '../hooks/useAthleteProfile'
import { MOVEMENT_PATTERN_LABEL, type MovementPattern } from '../muscleMap'
import type { AthleteLimitation, LimitationSeverity } from '../types.athlete'

// The limitations half of AthleteProfileSheet — split out once the sheet's
// profile section + this list together would have crossed the ~150-line
// guideline. Shows EVERY limitation (not just active ones): an inactive row
// stays visible, muted, with a one-tap way back in — deleting is a separate,
// confirmed action, never implied by "inactive".

const SEVERITY_OPTIONS: { id: LimitationSeverity; label: string }[] = [
  { id: 'avoid',   label: 'Avoid' },
  { id: 'limit',   label: 'Limit' },
  { id: 'monitor', label: 'Monitor' },
]

const PATTERN_OPTIONS = Object.entries(MOVEMENT_PATTERN_LABEL) as [MovementPattern, string][]

const PILL = 'px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg transition-colors'

function SeverityPills({ value, onChange }: { value: LimitationSeverity; onChange: (v: LimitationSeverity) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SEVERITY_OPTIONS.map(o => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`${PILL} ${value === o.id ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function LimitationRow({ item, onDeleteRequest }: { item: AthleteLimitation; onDeleteRequest: () => void }) {
  const update = useUpdateLimitation()
  return (
    <li className={`rounded-xl border border-ink-200 p-3 flex flex-col gap-2 ${item.active ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-900">{MOVEMENT_PATTERN_LABEL[item.movement_pattern]}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => update.mutate({ id: item.id, patch: { active: !item.active } })}
            className="min-h-[44px] px-2.5 text-[11px] font-medium rounded-lg border border-ink-200 text-ink-500 hover:bg-cream-100"
          >
            {item.active ? 'Active' : 'Reactivate'}
          </button>
          <button
            type="button"
            onClick={onDeleteRequest}
            aria-label="Delete limitation"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      </div>
      <SeverityPills value={item.severity} onChange={severity => update.mutate({ id: item.id, patch: { severity } })} />
      {item.note && <p className="text-xs text-ink-500">{item.note}</p>}
    </li>
  )
}

export function LimitationsList() {
  const { data: limitations = [] } = useAthleteLimitations()
  const create = useCreateLimitation()
  const del = useDeleteLimitation()
  const [deleting, setDeleting] = useState<AthleteLimitation | null>(null)
  const [pattern, setPattern] = useState<MovementPattern>(PATTERN_OPTIONS[0][0])
  // New limitations start at 'monitor', never a forced 'avoid'/'limit' — the
  // athlete escalates severity in place once it's clear it matters.
  const [severity, setSeverity] = useState<LimitationSeverity>('monitor')
  const [note, setNote] = useState('')

  function add() {
    create.mutate(
      { movement_pattern: pattern, severity, note: note.trim() || undefined },
      { onSuccess: () => setNote('') },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Limitations</p>

      {limitations.length > 0 && (
        <ul className="flex flex-col gap-2">
          {limitations.map(item => (
            <LimitationRow key={item.id} item={item} onDeleteRequest={() => setDeleting(item)} />
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-dashed border-ink-200 p-3 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <select
            value={pattern}
            onChange={e => setPattern(e.target.value as MovementPattern)}
            className="min-h-[44px] flex-1 min-w-[11rem] rounded-lg border border-ink-200 bg-cream-50 px-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
          >
            {PATTERN_OPTIONS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <SeverityPills value={severity} onChange={setSeverity} />
        </div>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Note (optional) — e.g. how it was diagnosed, what to avoid"
          className="min-h-[44px] rounded-lg border border-ink-200 bg-cream-50 px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
        />
        <button
          type="button"
          onClick={add}
          disabled={create.isPending}
          className="self-start min-h-[44px] px-4 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 disabled:opacity-50 transition-colors"
        >
          + Add limitation
        </button>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this limitation?"
        message={deleting ? MOVEMENT_PATTERN_LABEL[deleting.movement_pattern] : undefined}
        onConfirm={() => { if (deleting) del.mutate(deleting.id) }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
