// "Possibly incomplete night" — a pure signal for a night whose START never
// arrived from Health Auto Export.
//
// Why a night gets cut (measured against the live rows, 2026-09-27): the
// regular "Since Last Sync" automation re-summarises sleep from a window that
// begins about 6 hours before its PREVIOUS run, and the Apple Watch hands a
// night to the iPhone some minutes after you wake. When a run lands in that gap
// it exports no sleep, and the next run's window no longer reaches the start of
// the night — so only the end arrives, as a row that starts hours late but ends
// at the real wake time. Reconstructed from creation times, this happened on
// about half of the nights in a month (15 min to 3 h lost each time) until the
// weekly "Previous 7 Days" run re-sent them. The fix is the "Sleep catch-up"
// automation (docs/health-auto-export/06-sleep-catch-up.json); this module only
// SAYS when a night on screen still looks cut, it never changes a number.
//
// The rule — a night is flagged when BOTH hold:
//   1. its first sleep starts ≥ 2 h after your EARLY-SIDE start: the lower
//      quartile of the starts of up to 14 earlier nights from the last 28 days
//      (each ≥ 3 h asleep, not itself flagged, not manual; at least 5 needed);
//   2. its total is below your usual (median) total.
// Why these numbers, from a month of the owner's rows replayed as they stood
// the day after each night: a cut only ever moves a start LATER, and cuts hit
// about half the nights, so the median start was dragged late by the very
// nights it should expose — the lower quartile is not. With it, +2 h caught 6
// of the 10 nights that had lost ≥ 30 min (every loss over 2.5 h) with one
// false alarm in 27 intact nights; the median caught 0 at +2 h and 6 at
// +75 min, but then flagged 7 intact nights in the repaired history. Condition
// 2 keeps late nights you slept in on (long, so complete) unflagged, while a cut
// night keeps the normal wake time and comes out short. Smaller cuts stay
// unflagged on purpose — the catch-up repairs them within hours, and a note
// that fires on ordinary late nights teaches the reader to ignore it. A night
// with a manual entry is never flagged (the entry is the correction).
import type { HealthMetric } from './api/healthApi'
import { keptSleepSessionRows, manualNightKeys, sleepNightKey, type SleepSummary } from './healthAggregate'

export interface IncompleteNightRule {
  /** The night's first sleep starts at least this long after the usual start. */
  lateByMin: number
  /** …and its total is at least this far below the usual total (0 = any shortfall). */
  shortByMin: number
  /** Which quantile of the reference starts the lateness is measured from. */
  startQuantile: number
  referenceNights: number
  /** Reference nights must be at most this many days older than the night. */
  referenceDays: number
  minReferenceNights: number
  minReferenceHours: number
}

export const INCOMPLETE_NIGHT_RULE: IncompleteNightRule = {
  lateByMin: 120,
  shortByMin: 0,
  startQuantile: 0.25,
  referenceNights: 14,
  referenceDays: 28,
  minReferenceNights: 5,
  minReferenceHours: 3,
}

export interface IncompleteNight {
  /** Wake day — the key every sleep surface files the night under. */
  date: string
  /** Local wall-clock start of the night's first kept session, "04:54". */
  startClock: string
  /** Median start of the reference nights — what "usually" means on screen. */
  typicalStartClock: string
  /** Minutes after the typical (median) start. */
  lateByMin: number
  total: number
  /** Median total of the reference nights, hours. */
  usualTotal: number
}

const DAY_MS = 86_400_000

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** A HAE session start ("2026-09-26 04:54:05 +0200") as minutes after 12:00 on
 *  the day BEFORE the wake day, read from the string's own local wall-clock
 *  digits (no timezone maths). 23:00 the evening before → 660, 01:00 → 780.
 *  Null for a string without an explicit offset — its local time is unknown. */
export function startMinutesForWakeDay(sleepStart: unknown, wakeDay: string): number | null {
  if (typeof sleepStart !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*[+-]\d{2}:?\d{2}$/.exec(sleepStart.trim())
  if (!m) return null
  const dayDiff = (Date.parse(`${wakeDay}T00:00:00Z`) - Date.parse(`${m[1]}T00:00:00Z`)) / DAY_MS
  if (!Number.isFinite(dayDiff)) return null
  return Number(m[2]) * 60 + Number(m[3]) - 720 + (1 - dayDiff) * 1440
}

/** Minutes-after-noon back to a wall clock, "04:54". */
export function clockFromNoonMinutes(min: number): string {
  const t = ((Math.round(min) + 720) % 1440 + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Linear-interpolated quantile (q = 0.5 is the median). */
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** Nights in [from, to] (wake days, inclusive) that look cut at the start.
 *  `nights` is computeSleepSummary's output over the same points; nights before
 *  `from` in it serve as the baseline, so pass the whole fetched range. */
export function findIncompleteNights(
  points: HealthMetric[], nights: SleepSummary[], from: string, to: string,
  R: IncompleteNightRule = INCOMPLETE_NIGHT_RULE,
): IncompleteNight[] {
  const manual = manualNightKeys(points)
  const byNight = new Map<string, HealthMetric[]>()
  for (const p of points) {
    const k = sleepNightKey(p)
    const arr = byNight.get(k)
    if (arr) arr.push(p)
    else byNight.set(k, [p])
  }
  const startCache = new Map<string, number | null>()
  const startOf = (date: string): number | null => {
    if (startCache.has(date)) return startCache.get(date) ?? null
    let best: number | null = null
    for (const row of keptSleepSessionRows(byNight.get(date) ?? [], date)) {
      const m = startMinutesForWakeDay(row.value?.sleepStart, date)
      if (m != null && (best == null || m < best)) best = m
    }
    startCache.set(date, best)
    return best
  }

  // Chronological over EVERY night, so a night already flagged never drags the
  // "usual" start of the nights after it later — the baseline is complete
  // nights only, and the answer for a window never depends on where it begins.
  const sorted = [...nights].filter(n => n.date <= to).sort((a, b) => a.date.localeCompare(b.date))
  const flagged = new Set<string>()
  const out: IncompleteNight[] = []
  sorted.forEach((night, i) => {
    if (manual.has(night.date)) return
    const start = startOf(night.date)
    if (start == null) return
    const ref: { start: number; total: number }[] = []
    const oldest = shiftDay(night.date, -R.referenceDays)
    for (let j = i - 1; j >= 0 && ref.length < R.referenceNights; j--) {
      const n = sorted[j]
      if (n.date < oldest) break
      if (manual.has(n.date) || flagged.has(n.date) || n.total < R.minReferenceHours) continue
      const s = startOf(n.date)
      if (s != null) ref.push({ start: s, total: n.total })
    }
    if (ref.length < R.minReferenceNights) return
    const starts = ref.map(r => r.start)
    const earlyStart = quantile(starts, R.startQuantile)
    const typicalStart = quantile(starts, 0.5)
    const usualTotal = quantile(ref.map(r => r.total), 0.5)
    const shortByMin = (usualTotal - night.total) * 60
    if (start - earlyStart < R.lateByMin || shortByMin <= R.shortByMin) return
    flagged.add(night.date)
    if (night.date < from) return
    out.push({
      date: night.date,
      startClock: clockFromNoonMinutes(start),
      typicalStartClock: clockFromNoonMinutes(typicalStart),
      lateByMin: Math.round(start - typicalStart),
      total: night.total,
      usualTotal,
    })
  })
  return out
}
