import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { entityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
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


function SeverityPills({ value, onChange }: { value: LimitationSeverity; onChange: (v: LimitationSeverity) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SEVERITY_OPTIONS.map(o => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className="pill-tab bg-surface-2 px-3 text-meta"
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
    <li className={`flex flex-col gap-2 rounded-row border border-line p-3 ${item.active ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-semibold text-fg">{MOVEMENT_PATTERN_LABEL[item.movement_pattern]}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => update.mutate({ id: item.id, patch: { active: !item.active } })}
            className="btn-secondary btn-sm px-2.5 text-meta"
          >
            {item.active ? 'Active' : 'Reactivate'}
          </button>
          <button
            type="button"
            onClick={onDeleteRequest}
            aria-label="Delete limitation"
            className="icon-btn text-fg-faint hover:!bg-danger-soft hover:!text-danger"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <SeverityPills value={item.severity} onChange={severity => update.mutate({ id: item.id, patch: { severity } })} />
      {item.note && <p className="text-meta text-fg-muted">{item.note}</p>}
    </li>
  )
}

export function LimitationsList() {
  const { data: limitations = [] } = useAthleteLimitations()
  const create = useCreateLimitation()
  const del = useDeleteLimitation()
  const [pattern, setPattern] = useState<MovementPattern>(PATTERN_OPTIONS[0][0])
  // New limitations start at 'monitor', never a forced 'avoid'/'limit' — the
  // athlete escalates severity in place once it's clear it matters.
  const [severity, setSeverity] = useState<LimitationSeverity>('monitor')
  const [note, setNote] = useState('')

  async function confirmDelete(item: AthleteLimitation) {
    const ok = await entityModal.confirm({
      title: 'Delete this limitation?', message: MOVEMENT_PATTERN_LABEL[item.movement_pattern],
      confirmLabel: 'Delete', destructive: true,
    })
    if (ok) del.mutate(item.id)
  }

  function add() {
    create.mutate(
      { movement_pattern: pattern, severity, note: note.trim() || undefined },
      { onSuccess: () => setNote('') },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="section-label">Limitations</p>

      {limitations.length > 0 && (
        <ul className="flex flex-col gap-2">
          {limitations.map(item => (
            <LimitationRow key={item.id} item={item} onDeleteRequest={() => void confirmDelete(item)} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-row border border-dashed border-line p-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={pattern}
            onChange={e => setPattern(e.target.value as MovementPattern)}
            className="select min-w-[11rem] flex-1"
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
          className="input"
        />
        <Button className="self-start" icon={<Plus />} loading={create.isPending} onClick={add}>Add limitation</Button>
      </div>

    </div>
  )
}
