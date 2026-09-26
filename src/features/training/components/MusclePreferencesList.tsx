import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { entityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useMusclePreferences, useUpsertMusclePreference, useDeleteMusclePreference } from '../hooks/useAthleteProfile'
import { MAJOR_MUSCLES, labelForSlug } from '../muscleMap'
import type { AthleteMusclePreference, MusclePreference } from '../types.athlete'

// The muscle-preferences half of AthleteProfileSheet, mirroring
// LimitationsList's own shape exactly (every row visible, delete is a
// separate confirmed action). Two real states only — `priority` (elevated
// urgency below MEV) and `exclude_direct` (suppresses ONLY the "no direct
// work for this muscle" warning; every indirect/secondary credited set
// still counts normally in every aggregate, nothing is zeroed). A muscle
// with no row here is the normal, unmarked default — there is no third
// stored state, and this is deliberately NOT called "deprioritized": "no
// direct ab training" is not the same claim as "abs matters less".

const PREF_OPTIONS: { id: MusclePreference; label: string }[] = [
  { id: 'priority',       label: 'Priority' },
  { id: 'exclude_direct', label: 'Exclude direct work' },
]


function PrefPills({ value, onChange }: { value: MusclePreference; onChange: (v: MusclePreference) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PREF_OPTIONS.map(o => (
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

function PrefRow({ item, onDeleteRequest }: { item: AthleteMusclePreference; onDeleteRequest: () => void }) {
  const upsert = useUpsertMusclePreference()
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-row border border-line p-3">
      <span className="text-body font-semibold text-fg">{labelForSlug(item.muscle_slug)}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <PrefPills value={item.preference} onChange={preference => upsert.mutate({ muscle_slug: item.muscle_slug, preference })} />
        <button
          type="button"
          onClick={onDeleteRequest}
          aria-label={`Remove ${labelForSlug(item.muscle_slug)} preference`}
          className="icon-btn text-fg-faint hover:!bg-danger-soft hover:!text-danger"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  )
}

export function MusclePreferencesList() {
  const { data: preferences = [] } = useMusclePreferences()
  const upsert = useUpsertMusclePreference()
  const del = useDeleteMusclePreference()

  const takenSlugs = new Set(preferences.map(p => p.muscle_slug))
  const available = [...MAJOR_MUSCLES].filter(slug => !takenSlugs.has(slug))
  const [slug, setSlug] = useState<string>(available[0] ?? '')
  const [pref, setPref] = useState<MusclePreference>('priority')

  async function confirmDelete(item: AthleteMusclePreference) {
    const ok = await entityModal.confirm({
      title: 'Remove this preference?', message: labelForSlug(item.muscle_slug),
      confirmLabel: 'Remove', destructive: true,
    })
    if (ok) del.mutate(item.muscle_slug)
  }

  function add() {
    if (!slug) return
    upsert.mutate({ muscle_slug: slug, preference: pref })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="section-label">Muscle preferences</p>
      <p className="text-meta text-fg-muted">
        Mark a muscle Priority to get more urgent messaging when it falls below its usual dose. Exclude direct work
        for a muscle you deliberately don&apos;t train on its own (e.g. abs) — the sets it still earns from other
        exercises keep counting, only the &quot;you have no direct work for this&quot; nag is suppressed.
      </p>

      {preferences.length > 0 && (
        <ul className="flex flex-col gap-2">
          {preferences.map(item => (
            <PrefRow key={item.id} item={item} onDeleteRequest={() => void confirmDelete(item)} />
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="flex flex-col gap-2 rounded-row border border-dashed border-line p-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={slug}
              onChange={e => setSlug(e.target.value)}
              className="select min-w-[11rem] flex-1"
            >
              {available.map(s => <option key={s} value={s}>{labelForSlug(s)}</option>)}
            </select>
            <PrefPills value={pref} onChange={setPref} />
          </div>
          <Button className="self-start" icon={<Plus />} loading={upsert.isPending} onClick={add}>Add preference</Button>
        </div>
      )}

    </div>
  )
}
