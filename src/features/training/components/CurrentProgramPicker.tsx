import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui'
import { useHevyRoutines } from '../hooks/useHevyRoutines'
import { useCurrentProgramRoutines, useSetCurrentProgramRoutines } from '../hooks/useAthleteProfile'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { useTodayStr } from '../hooks/useTrainingSessions'
import { suggestCurrentProgramRoutineIds, SUGGESTION_WINDOW_DAYS } from '../progress-engine'

// Explicit (never inferred) current-program selection. Next, Program and
// Progress all scope to the routines checked here (plus any freeform,
// routine-less session, which always counts as current —
// progress-engine/program.ts::filterToCurrentProgram).
//
// A pure recency rule was rejected as the SELECTION: a vacation, a skipped
// week or an old routine trained once would misclassify the program. Recency
// only pre-checks a starting point while nothing is saved — routines actually
// TRAINED in the last 4 weeks (from workouts, never from when a routine was
// last edited in Hevy) — and the athlete still confirms by saving.

export function CurrentProgramPicker({ onSaved }: { onSaved?: () => void } = {}) {
  const { data: routines = [], isLoading: loadingRoutines } = useHevyRoutines()
  const { data: current = [], isLoading: loadingCurrent } = useCurrentProgramRoutines()
  const { data: history } = useTrainingHistory()
  const today = useTodayStr()
  const save = useSetCurrentProgramRoutines()

  const suggested = useMemo(
    () => new Set(suggestCurrentProgramRoutineIds(routines.map(r => r.id), history?.sets ?? [], today)),
    [routines, history, today],
  )

  // null = untouched: derived from the saved program, or from the suggestion
  // when nothing is saved. Once the athlete ticks a box their draft wins.
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const isLoading = loadingRoutines || loadingCurrent
  const savedIds = useMemo(() => new Set(current.map(c => c.routine_id)), [current])
  const checked = draft ?? (savedIds.size > 0 ? savedIds : suggested)

  const isDirty = checked.size !== savedIds.size || [...checked].some(id => !savedIds.has(id))

  function toggle(id: string) {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setDraft(next)
  }

  if (isLoading) return <p className="text-meta text-fg-muted">Loading routines…</p>
  if (routines.length === 0) return <p className="text-meta text-fg-muted">No Hevy routines synced yet — sync, or create one under Library → Routines.</p>

  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-fg-muted">
        Which routines are you running now? Check more than one for a split (e.g. Upper + Lower). Next, Program and Progress
        only use these — never guessed from recent activity, so a skipped week never makes it look like your program changed.
      </p>
      <ul className="flex max-w-md flex-col gap-1.5">
        {routines.map(r => (
          <li key={r.id}>
            <label className="row cursor-pointer border border-line">
              <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} className="h-[18px] w-[18px] shrink-0 accent-accent-500" />
              <span className="flex-1 text-body text-fg">{r.title}</span>
              {savedIds.size === 0 && suggested.has(r.id) && (
                <span className="chip shrink-0 border-accent-200 bg-accent-50 text-accent-700" title={`Trained in the last ${SUGGESTION_WINDOW_DAYS} days`}>Recently trained</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        className="self-start"
        loading={save.isPending}
        disabled={!isDirty}
        onClick={() => save.mutate([...checked], { onSuccess: () => { setDraft(null); onSaved?.() } })}
      >
        Save current program
      </Button>
    </div>
  )
}
