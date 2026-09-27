import { useState } from 'react'
import { Button } from '../../../../shared/ui'
import { entityModal } from '../../../../shared/modals'
import { useUpsertExerciseTargetOverride, useDeleteExerciseTargetOverride } from '../../hooks/useAthleteProfile'
import type { ExerciseTargetOverride } from '../../types.athlete'

const clampReps = (n: number) => Math.min(100, Math.max(1, Math.round(n)))

/** Your own rep range for one exercise. It outranks the routine's range in
 *  the progress engine (policies.resolveExpectation) — the routine's set
 *  count is kept, only the rep range changes. */
export function TargetOverrideEditor({ templateId, title, current, fallback, onDone }: {
  templateId: string
  title: string
  current: ExerciseTargetOverride | null
  fallback: { repMin: number; repMax: number } | null
  onDone: () => void
}) {
  const upsert = useUpsertExerciseTargetOverride()
  const del = useDeleteExerciseTargetOverride()
  const [min, setMin] = useState(String(current?.rep_range_start ?? fallback?.repMin ?? 8))
  const [max, setMax] = useState(String(current?.rep_range_end ?? fallback?.repMax ?? 12))
  const lo = Number(min), hi = Number(max)
  const valid = Number.isFinite(lo) && Number.isFinite(hi) && lo >= 1 && hi >= lo && hi <= 100

  async function remove() {
    const ok = await entityModal.confirm({ title: 'Remove your own target?', message: `${title} goes back to the routine's rep range.`, confirmLabel: 'Remove', destructive: true })
    if (ok) del.mutate(templateId, { onSuccess: onDone })
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-row border border-line bg-surface-2 p-3">
      <p className="text-meta text-fg-muted">Your own rep range for {title}. It replaces the routine&apos;s range for targets and verdicts; the number of sets stays the routine&apos;s.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className="field-label">From</span>
          <input className="input w-20" inputMode="numeric" value={min} onChange={e => setMin(e.target.value.replace(/\D/g, ''))} aria-label="Minimum reps" />
        </label>
        <label className="flex flex-col">
          <span className="field-label">To</span>
          <input className="input w-20" inputMode="numeric" value={max} onChange={e => setMax(e.target.value.replace(/\D/g, ''))} aria-label="Maximum reps" />
        </label>
        <span className="pb-3 text-meta text-fg-muted">reps</span>
      </div>
      {!valid && <p data-tone="warn" className="tone-text text-meta">The range needs 1–100 reps, with “to” at least “from”.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!valid} loading={upsert.isPending}
          onClick={() => upsert.mutate({ exercise_template_id: templateId, rep_range_start: clampReps(lo), rep_range_end: clampReps(hi) }, { onSuccess: onDone })}>
          Save target
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        {current && <Button size="sm" variant="ghost" loading={del.isPending} onClick={() => void remove()}>Use routine&apos;s range</Button>}
      </div>
    </div>
  )
}
