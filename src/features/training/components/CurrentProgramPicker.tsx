import { useEffect, useState } from 'react'
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

  const [checked, setChecked] = useState<Set<string> | null>(null)
  const isLoading = loadingRoutines || loadingCurrent

  // Seed the local checked-set once real data has loaded — from the saved
  // selection if one exists, otherwise from the recency hint (routines
  // updated in the last RECENT_DAYS days), never re-seeded on a background
  // refetch once the athlete has started ticking boxes.
  useEffect(() => {
    if (checked !== null || isLoading) return
    if (current.length > 0) {
      setChecked(new Set(current.map(c => c.routine_id)))
    } else {
      const cutoff = Date.now() - RECENT_DAYS * 86_400_000
      const suggested = routines.filter(r => new Date(r.hevy_updated_at).getTime() >= cutoff).map(r => r.id)
      setChecked(new Set(suggested))
    }
  }, [checked, isLoading, current, routines])

  const savedIds = new Set(current.map(c => c.routine_id))
  const isDirty = checked != null && (
    checked.size !== savedIds.size || [...checked].some(id => !savedIds.has(id))
  )

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (isLoading || checked === null) {
    return <p className="text-xs text-ink-400">Loading routines…</p>
  }

  if (routines.length === 0) {
    return <p className="text-xs text-ink-400">No Hevy routines synced yet — sync from the Routines tab first.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-500">
        Which routines are your current program? The Progress tab only judges exercises trained under these — never
        guessed from recent activity alone, so a vacation or a skipped week never makes it look like your program
        changed. Check more than one for a split (e.g. Upper + Lower).
      </p>
      <ul className="flex flex-col gap-1.5">
        {routines.map(r => {
          const recentlyUsed = Date.now() - new Date(r.hevy_updated_at).getTime() < RECENT_DAYS * 86_400_000
          const wasSuggested = savedIds.size === 0 && recentlyUsed
          return (
            <li key={r.id} className="flex items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2.5 min-h-[44px]">
              <input
                type="checkbox"
                checked={checked.has(r.id)}
                onChange={() => toggle(r.id)}
                className="w-[18px] h-[18px] accent-accent-500 shrink-0"
              />
              <span className="flex-1 text-sm text-ink-800">{r.title}</span>
              {wasSuggested && checked.has(r.id) && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-600 border border-accent-300 rounded-full px-2 py-0.5 shrink-0">
                  Suggested
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={() => save.mutate([...checked])}
        disabled={!isDirty || save.isPending}
        className="self-start min-h-[44px] px-4 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 disabled:opacity-50 transition-colors"
      >
        Save current program
      </button>
    </div>
  )
}
