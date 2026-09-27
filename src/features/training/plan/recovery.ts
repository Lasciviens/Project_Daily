// Recovery context for the Next and Progress tabs — pure (runtime import only
// from muscleMap, itself pure), tested by scripts/verify-training-plan.cjs.
//
// Deliberately NO readiness score (house rule: no synthetic composite
// metrics). Two plain facts and one map:
//  - Last night's sleep against the ≥7 h adult guideline (Watson 2015,
//    AASM/SRS consensus). After a night of ≤6 h, performance drops on average
//    (Craven 2022, Sports Med meta-analysis: about −7.6% across tasks), so the
//    line suggests not chasing records that day.
//  - Resting heart rate: the last-7-day average against your own 60-day
//    median. A rise of ≥5 bpm is a common monitoring convention for fatigue,
//    illness or stress (a heuristic, not a validated threshold — see the
//    "Deloads and fatigue signals" entry in research-science.json).
//  - Days since each muscle last got at least 2 fractional sets in one
//    workout (the research file's frequency rule). There is no validated
//    per-muscle "recovered" clock, so the map shows days, not readiness.

import { contribution, slugForHevyGroup } from '../muscleMap'
import type { ProgressSetRow } from '../progressAggregate'

export const SLEEP_GUIDELINE_H = 7
export const SHORT_SLEEP_H = 6
export const RHR_RISE_BPM = 5

export type NoteTone = 'success' | 'warn' | 'neutral'

export interface RecoveryNote { text: string; tone: NoteTone }

export function fmtHours(h: number): string {
  const total = Math.round(h * 60)
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`
}

/** Last night's sleep, or null when the newest night isn't from today's or
 *  yesterday's wake-up (an old night says nothing about today). */
export function sleepNote(lastNight: { date: string; hours: number } | null, today: string, yesterday: string): RecoveryNote | null {
  if (!lastNight || lastNight.hours <= 0) return null
  if (lastNight.date !== today && lastNight.date !== yesterday) return null
  const h = fmtHours(lastNight.hours)
  if (lastNight.hours < SHORT_SLEEP_H) return { tone: 'warn', text: `Slept ${h} — a short night. Performance usually dips; not a day to chase records.` }
  if (lastNight.hours < SLEEP_GUIDELINE_H) return { tone: 'neutral', text: `Slept ${h} — a little under the 7-hour guideline.` }
  return { tone: 'success', text: `Slept ${h} — the 7-hour guideline is met.` }
}

export function restingHrNote(rhr7: number | null, baselineMedian: number | null): RecoveryNote | null {
  if (rhr7 == null) return null
  const now = Math.round(rhr7)
  if (baselineMedian == null) return { tone: 'neutral', text: `Resting heart rate ${now} bpm (7-day average; not enough history for your usual level yet).` }
  const delta = Math.round(rhr7 - baselineMedian)
  const usual = Math.round(baselineMedian)
  if (delta >= RHR_RISE_BPM) return { tone: 'warn', text: `Resting heart rate ${now} bpm, +${delta} above your usual ${usual} — can mean fatigue, illness or stress.` }
  if (delta <= -RHR_RISE_BPM) return { tone: 'neutral', text: `Resting heart rate ${now} bpm, ${delta} below your usual ${usual}.` }
  return { tone: 'success', text: `Resting heart rate ${now} bpm, in your usual range (${usual}).` }
}

// ── Muscle recovery map ─────────────────────────────────────────────────────

export interface TemplateMuscleGroups { primary: string | null; secondary: readonly string[] }

export interface MuscleLastTrained { slug: string; lastDate: string; daysSince: number; credit: number }

export const MIN_CREDIT = 2

function daysApart(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000)
}

/** The last workout (on or before today) in which each muscle got at least
 *  `minCredit` fractional sets — primary 1.0, secondary 0.5, warm-ups out. */
export function computeMuscleLastTrained(
  sets: readonly ProgressSetRow[],
  templateMuscles: ReadonlyMap<string, TemplateMuscleGroups>,
  today: string,
  minCredit = MIN_CREDIT,
): Map<string, MuscleLastTrained> {
  const perWorkout = new Map<string, { date: string; credit: Map<string, number> }>()
  for (const s of sets) {
    if (s.set_type === 'warmup' || s.date > today) continue
    const m = templateMuscles.get(s.exercise_template_id)
    if (!m) continue
    const w = perWorkout.get(s.workout_id) ?? { date: s.date, credit: new Map<string, number>() }
    const primary = slugForHevyGroup(m.primary)
    if (primary) w.credit.set(primary, (w.credit.get(primary) ?? 0) + contribution(s.exercise_template_id, primary, 'primary'))
    for (const g of m.secondary) {
      const slug = slugForHevyGroup(g)
      if (!slug || slug === primary) continue
      w.credit.set(slug, (w.credit.get(slug) ?? 0) + contribution(s.exercise_template_id, slug, 'secondary'))
    }
    perWorkout.set(s.workout_id, w)
  }
  const out = new Map<string, MuscleLastTrained>()
  for (const w of perWorkout.values()) {
    for (const [slug, credit] of w.credit) {
      if (credit < minCredit) continue
      const prev = out.get(slug)
      if (!prev || w.date > prev.lastDate || (w.date === prev.lastDate && credit > prev.credit)) {
        out.set(slug, { slug, lastDate: w.date, daysSince: daysApart(w.date, today), credit: Math.round(credit * 10) / 10 })
      }
    }
  }
  return out
}

export type RecencyBucket = 'today' | 'd1_2' | 'd3_4' | 'd5_7' | 'd8_14' | 'd15' | 'never'

export const RECENCY_BUCKETS: { key: RecencyBucket; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'd1_2',  label: '1–2 days' },
  { key: 'd3_4',  label: '3–4 days' },
  { key: 'd5_7',  label: '5–7 days' },
  { key: 'd8_14', label: '8–14 days' },
  { key: 'd15',   label: '15+ days' },
  { key: 'never', label: 'Not in history' },
]

export function recencyBucket(daysSince: number | null | undefined): RecencyBucket {
  if (daysSince == null) return 'never'
  if (daysSince <= 0) return 'today'
  if (daysSince <= 2) return 'd1_2'
  if (daysSince <= 4) return 'd3_4'
  if (daysSince <= 7) return 'd5_7'
  if (daysSince <= 14) return 'd8_14'
  return 'd15'
}
