import { useMemo } from 'react'
import { formatLocalDate, localDayOf } from '../../../shared/utils/dateUtils'
import { useModalStore, type EntityModalRequest } from '../../../shared/modals'
import { useHevyWorkoutDetail, useHevyWorkoutsRange } from '../../training/hooks/useHevyWorkouts'
import { matchHealthWorkout, type TimedWorkout } from '../../training/workoutHealthMatch'
import type { HevyWorkout } from '../../training/types.hevy'

// Health ↔ Training: the Hevy session recorded at the same time as an Apple
// Health workout, by the one overlap rule (training/workoutHealthMatch.ts) the
// Training side uses the other way round.

/** Local days a workout touches, looking 30 minutes back (a session just after
 *  midnight can have its watch workout start the day before). */
function daysOf(w: TimedWorkout | null): { from: string; to: string } | null {
  if (!w?.start_time) return null
  const start = new Date(w.start_time).getTime()
  if (!Number.isFinite(start)) return null
  const from = formatLocalDate(new Date(start - 30 * 60_000))
  const to = localDayOf(w.end_time) ?? localDayOf(w.start_time) ?? from
  return { from, to: to < from ? from : to }
}

/** The Hevy workout that is the same session as this Apple one, with its sets. */
export function useMatchedHevyWorkout(apple: TimedWorkout | null) {
  const days = daysOf(apple)
  const list = useHevyWorkoutsRange(days?.from ?? '', days?.to ?? '', { enabled: !!days })
  // keepPreviousData would briefly match against another day's sessions.
  const loading = !!days && (list.isLoading || list.isPlaceholderData)
  const match = useMemo<HevyWorkout | null>(
    () => (apple && !loading ? matchHealthWorkout(apple, list.data ?? []) : null),
    [apple, loading, list.data],
  )
  const detail = useHevyWorkoutDetail(match?.id ?? null)
  return { match, detail, isLoading: loading || (!!match && detail.isLoading), isError: list.isError }
}

/** For a list: which Apple workout has a Hevy session, from ONE range read. */
export function useHevyMatches<T extends TimedWorkout & { id: string }>(from: string, to: string, apple: readonly T[]) {
  const list = useHevyWorkoutsRange(from, to, { enabled: apple.length > 0 })
  return useMemo(() => {
    const out = new Map<string, HevyWorkout>()
    if (list.isPlaceholderData) return out
    for (const a of apple) {
      const m = matchHealthWorkout(a, list.data ?? [])
      if (m) out.set(a.id, m)
    }
    return out
  }, [apple, list.data, list.isPlaceholderData])
}

/** The Training session popup for one logged Hevy workout. */
export function trainingSessionRequest(hevyWorkoutId: string): EntityModalRequest {
  return { kind: 'training-session', workoutId: hevyWorkoutId }
}

/** Also matches the deprecated `hevy-workout` name for the same popup. */
export function isTrainingSessionRequest(r: EntityModalRequest, hevyWorkoutId: string): boolean {
  return (r.kind === 'training-session' && r.workoutId === hevyWorkoutId) || (r.kind === 'hevy-workout' && r.id === hevyWorkoutId)
}

/**
 * True when the popup right below `self` in the modal stack already shows
 * what a link would open — then the link is simply "back" (closing `self`),
 * so Health → Training → Health can never pile up an endless stack.
 */
export function useLinkIsBack(self: EntityModalRequest | null, isTarget: (below: EntityModalRequest) => boolean): boolean {
  return useModalStore(s => {
    if (!self) return false
    const i = s.stack.findIndex(e => e.request === self)
    return i > 0 && isTarget(s.stack[i - 1].request)
  })
}
