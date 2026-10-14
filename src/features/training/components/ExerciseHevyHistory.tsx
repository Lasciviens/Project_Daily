import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, SegmentedControl, SkeletonText, TonePill, Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useHevyExerciseHistory } from '../hooks/useHevyExerciseTemplates'
import { groupExerciseHistory, HISTORY_RANGES, type HevyHistorySet, type HistoryRange } from '../exerciseHistory'
import { formatSet, rpeSuffix } from '../setFormat'
import { SET_TYPE_META, type SetType } from '../setTypeMeta'

const isSetType = (t: string | null): t is SetType => !!t && t in SET_TYPE_META

function HistorySetChip({ s, exerciseType }: { s: HevyHistorySet; exerciseType?: string }) {
  const value = `${formatSet(s, exerciseType)}${rpeSuffix(s.rpe)}`
  if (!s.set_type || s.set_type === 'normal') return <span className="chip tabular-nums">{value}</span>
  const meta = isSetType(s.set_type) ? SET_TYPE_META[s.set_type] : null
  const label = meta?.label ?? s.set_type.replace(/_/g, ' ')
  return (
    <TonePill tone={meta?.tone ?? 'neutral'} className="tabular-nums">
      <span aria-hidden className="font-semibold">{meta?.short ?? label}</span>
      <span className="sr-only">{label}: </span>
      {value}
    </TonePill>
  )
}

/**
 * "History from Hevy" — Hevy's own record of this exercise (GET
 * /v1/exercise_history through hevy-api, a live call; cached 5 minutes),
 * beside the app's computed one. Open on the last 3 months; it can be folded.
 */
export function ExerciseHevyHistory({ templateId, exerciseType }: { templateId: string; exerciseType?: string }) {
  const [open, setOpen] = useState(true)
  const [range, setRange] = useState<HistoryRange>('3m')
  const history = useHevyExerciseHistory(templateId, range, open)
  const workouts = useMemo(() => groupExerciseHistory(history.data ?? []), [history.data])
  const setCount = history.data?.length ?? 0
  const typesShown = useMemo(() => [...new Set((history.data ?? []).map(s => s.set_type).filter(isSetType))].filter(t => t !== 'normal'), [history.data])
  const rangeLabel = HISTORY_RANGES.find(r => r.value === range)?.label.toLowerCase()

  return (
    <section className="border-t border-line pt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex min-h-9 w-full items-center justify-between gap-2 text-left">
        <span className="text-body font-semibold text-fg">History from Hevy</span>
        <ChevronDown aria-hidden className={`h-4 w-4 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl size="sm" options={HISTORY_RANGES} value={range} onChange={setRange} />
            {history.isSuccess && workouts.length > 0 && (
              <span className="text-meta tabular-nums text-fg-muted">{workouts.length} workout{workouts.length === 1 ? '' : 's'} · {setCount} set{setCount === 1 ? '' : 's'}</span>
            )}
          </div>
          {history.isPending ? (
            <SkeletonText lines={3} />
          ) : history.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-meta text-danger">Couldn't read Hevy's history: {history.error.message}</p>
              <Button size="sm" onClick={() => { void history.refetch() }}>Try again</Button>
            </div>
          ) : workouts.length === 0 ? (
            <p className="text-meta text-fg-muted">{range === 'all' ? 'Hevy has no sets of this exercise.' : `Hevy has no sets of this exercise in the last ${rangeLabel}.`}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {workouts.map(w => (
                <li key={w.workoutId} className="flex flex-col gap-1 py-2 first:pt-0">
                  <p className="flex min-w-0 items-baseline gap-2 text-meta">
                    <span className="shrink-0 font-semibold tabular-nums text-fg">{formatDate(w.startTime)}</span>
                    <Truncate className="text-fg-muted">{w.title}</Truncate>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {w.sets.map((s, i) => <HistorySetChip key={i} s={s} exerciseType={exerciseType} />)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {typesShown.length > 0 && (
            <p className="text-micro text-fg-muted">{typesShown.map(t => `${SET_TYPE_META[t].short} ${SET_TYPE_META[t].label.toLowerCase()}`).join(' · ')}</p>
          )}
        </div>
      )}
    </section>
  )
}
