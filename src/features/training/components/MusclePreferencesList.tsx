import { useState } from 'react'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
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

const PILL = 'px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg transition-colors'

function PrefPills({ value, onChange }: { value: MusclePreference; onChange: (v: MusclePreference) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PREF_OPTIONS.map(o => (
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

function PrefRow({ item, onDeleteRequest }: { item: AthleteMusclePreference; onDeleteRequest: () => void }) {
  const upsert = useUpsertMusclePreference()
  return (
    <li className="rounded-xl border border-ink-200 p-3 flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-ink-900">{labelForSlug(item.muscle_slug)}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <PrefPills value={item.preference} onChange={preference => upsert.mutate({ muscle_slug: item.muscle_slug, preference })} />
        <button
          type="button"
          onClick={onDeleteRequest}
          aria-label={`Remove ${labelForSlug(item.muscle_slug)} preference`}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
        >
          ✕
        </button>
      </div>
    </li>
  )
}

export function MusclePreferencesList() {
  const { data: preferences = [] } = useMusclePreferences()
  const upsert = useUpsertMusclePreference()
  const del = useDeleteMusclePreference()
  const [deleting, setDeleting] = useState<AthleteMusclePreference | null>(null)

  const takenSlugs = new Set(preferences.map(p => p.muscle_slug))
  const available = [...MAJOR_MUSCLES].filter(slug => !takenSlugs.has(slug))
  const [slug, setSlug] = useState<string>(available[0] ?? '')
  const [pref, setPref] = useState<MusclePreference>('priority')

  function add() {
    if (!slug) return
    upsert.mutate({ muscle_slug: slug, preference: pref })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Muscle preferences</p>
      <p className="text-xs text-ink-500">
        Mark a muscle Priority to get more urgent messaging when it falls below its usual dose. Exclude direct work
        for a muscle you deliberately don&apos;t train on its own (e.g. abs) — the sets it still earns from other
        exercises keep counting, only the &quot;you have no direct work for this&quot; nag is suppressed.
      </p>

      {preferences.length > 0 && (
        <ul className="flex flex-col gap-2">
          {preferences.map(item => (
            <PrefRow key={item.id} item={item} onDeleteRequest={() => setDeleting(item)} />
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="rounded-xl border border-dashed border-ink-200 p-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={slug}
              onChange={e => setSlug(e.target.value)}
              className="min-h-[44px] flex-1 min-w-[11rem] rounded-lg border border-ink-200 bg-cream-50 px-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
            >
              {available.map(s => <option key={s} value={s}>{labelForSlug(s)}</option>)}
            </select>
            <PrefPills value={pref} onChange={setPref} />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={upsert.isPending}
            className="self-start min-h-[44px] px-4 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 disabled:opacity-50 transition-colors"
          >
            + Add preference
          </button>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Remove this preference?"
        message={deleting ? labelForSlug(deleting.muscle_slug) : undefined}
        onConfirm={() => { if (deleting) del.mutate(deleting.muscle_slug) }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
