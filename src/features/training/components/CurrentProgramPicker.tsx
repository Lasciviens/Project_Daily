import { useMemo, useState } from 'react'
import { nowMs } from '../dateFormat'
import { Button } from '../../../shared/ui'
import { useHevyRoutines } from '../hooks/useHevyRoutines'
import { useCurrentProgramRoutines, useSetCurrentProgramRoutines } from '../hooks/useAthleteProfile'

// Explicit (never inferred) current-program selection — the Progress
// decision engine (progressDecisions.ts::filterToCurrentProgram) only
// evaluates exercises trained under a routine checked here (plus any
// freeform, routine-less session, which always counts as current).
//
// A pure recency window ("routine_id seen in the last 21-28 days") was
// drafted and explicitly rejected: a vacation, a skipped week, or an old
// routine trained once by coincidence would all misclassify what's
// actually current. Recency still gets ONE legitimate job here — the
// "Recently trained" hint pre-checking a sensible starting point the first
// time this list is empty — but the athlete always confirms explicitly by
// saving; the engine never runs on that hint alone.

const RECENT_DAYS = 28

export function CurrentProgramPicker() {
  const { data: routines = [], isLoading: loadingRoutines } = useHevyRoutines()
  const { data: current = [], isLoading: loadingCurrent } = useCurrentProgramRoutines()
  const save = useSetCurrentProgramRoutines()

  // null = untouched: the selection is derived from the saved program, or
  // from the recency hint when nothing is saved. Once the athlete ticks a box
  // their draft wins over any background refetch.
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const isLoading = loadingRoutines || loadingCurrent
  const checked = useMemo(() => {
    if (draft) return draft
    if (current.length > 0) return new Set(current.map(c => c.routine_id))
    const cutoff = nowMs() - RECENT_DAYS * 86_400_000
    return new Set(routines.filter(r => new Date(r.hevy_updated_at).getTime() >= cutoff).map(r => r.id))
  }, [draft, current, routines])

  const savedIds = new Set(current.map(c => c.routine_id))
  const isDirty = (
    checked.size !== savedIds.size || [...checked].some(id => !savedIds.has(id))
  )

  function toggle(id: string) {
    setDraft(() => {
      const next = new Set(checked)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (isLoading) {
    return <p className="text-meta text-fg-muted">Loading routines…</p>
  }

  if (routines.length === 0) {
    return <p className="text-meta text-fg-muted">No Hevy routines synced yet — sync from the Routines tab first.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-fg-muted">
        Which routines are your current program? The Progress tab only judges exercises trained under these — never
        guessed from recent activity alone, so a vacation or a skipped week never makes it look like your program
        changed. Check more than one for a split (e.g. Upper + Lower).
      </p>
      <ul className="flex flex-col gap-1.5">
        {routines.map(r => {
          const recentlyUsed = nowMs() - new Date(r.hevy_updated_at).getTime() < RECENT_DAYS * 86_400_000
          const wasSuggested = savedIds.size === 0 && recentlyUsed
          return (
            <li key={r.id}>
              <label className="row cursor-pointer border border-line">
              <input
                type="checkbox"
                checked={checked.has(r.id)}
                onChange={() => toggle(r.id)}
                className="h-[18px] w-[18px] shrink-0 accent-accent-500"
              />
              <span className="flex-1 text-body text-fg">{r.title}</span>
              {wasSuggested && checked.has(r.id) && (
                <span className="chip shrink-0 border-accent-200 bg-accent-50 text-accent-700">Suggested</span>
              )}
              </label>
            </li>
          )
        })}
      </ul>
      <Button
        variant="primary"
        className="self-start"
        loading={save.isPending}
        disabled={!isDirty}
        onClick={() => save.mutate([...checked], { onSuccess: () => setDraft(null) })}
      >
        Save current program
      </Button>
    </div>
  )
}
