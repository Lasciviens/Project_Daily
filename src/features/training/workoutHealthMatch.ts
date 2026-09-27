// Which Apple Health workout is the same session as a Hevy workout — pure and
// import-free (scripts/verify-training-log.cjs). Hevy writes its workouts to
// Apple Health, so the watch's "Traditional Strength Training" row usually
// starts within a second of the Hevy one; a watch workout started late or
// stopped late still overlaps most of it.
//
// Rule: the two intervals must overlap for at least 60% of the SHORTER one
// and 30% of the LONGER one. The second bound rejects a stray few-second
// watch workout at the very end of a long session (it sits 100% inside the
// session but says nothing about it); the first rejects a long walk that
// merely brushes the session. The largest overlap wins, then the nearest start.

export interface TimedWorkout {
  start_time: string | null
  end_time: string | null
  /** Used when end_time is missing. */
  duration_seconds?: number | null
}

export const MIN_SHORTER_OVERLAP = 0.6
export const MIN_LONGER_OVERLAP = 0.3

function interval(w: TimedWorkout): [number, number] | null {
  if (!w.start_time) return null
  const start = new Date(w.start_time).getTime()
  if (!Number.isFinite(start)) return null
  let end = w.end_time ? new Date(w.end_time).getTime() : NaN
  if (!Number.isFinite(end) && typeof w.duration_seconds === 'number' && Number.isFinite(w.duration_seconds)) end = start + w.duration_seconds * 1000
  return Number.isFinite(end) && end > start ? [start, end] : null
}

/** Overlap in seconds, 0 when either interval is unknown or they don't meet. */
export function overlapSeconds(a: TimedWorkout, b: TimedWorkout): number {
  const x = interval(a)
  const y = interval(b)
  if (!x || !y) return 0
  return Math.max(0, (Math.min(x[1], y[1]) - Math.max(x[0], y[0])) / 1000)
}

export function matchHealthWorkout<T extends TimedWorkout>(session: TimedWorkout, candidates: readonly T[]): T | null {
  const s = interval(session)
  if (!s) return null
  let best: { w: T; overlap: number; gap: number } | null = null
  for (const w of candidates) {
    const c = interval(w)
    if (!c) continue
    const overlap = overlapSeconds(session, w)
    if (overlap <= 0) continue
    const lenS = (s[1] - s[0]) / 1000
    const lenC = (c[1] - c[0]) / 1000
    if (overlap < MIN_SHORTER_OVERLAP * Math.min(lenS, lenC) || overlap < MIN_LONGER_OVERLAP * Math.max(lenS, lenC)) continue
    const gap = Math.abs(c[0] - s[0])
    if (!best || overlap > best.overlap || (overlap === best.overlap && gap < best.gap)) best = { w, overlap, gap }
  }
  return best?.w ?? null
}
