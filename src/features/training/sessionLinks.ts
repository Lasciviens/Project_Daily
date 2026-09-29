// Which logged workout a `training-session` popup ended up showing. A popup
// opened from a PLAN (Daily's agenda and Training card, Home) carries no
// workout id, yet shows the workout that covered that plan — so the Apple
// workout popup opened from it can only tell "the popup below is this same
// session, go back to it" by asking here (health/hooks/useWorkoutLinks).
// Keyed by the modal request object, whose identity the modal stack keeps; a
// WeakMap, so a closed popup's entry goes with it. Import-free.

const shown = new WeakMap<object, string>()

/** Records (or clears) the workout the popup opened for `request` shows. */
export function rememberShownWorkout(request: object, workoutId: string | null): void {
  if (workoutId) shown.set(request, workoutId)
  else shown.delete(request)
}

/** The workout a training-session request shows: the one it asked for by id,
 *  else the one it resolved to (a covered plan); null when not known. */
export function shownWorkoutIdOf(request: { workoutId?: string }): string | null {
  return request.workoutId ?? shown.get(request) ?? null
}
